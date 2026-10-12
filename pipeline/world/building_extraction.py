"""Phase A: offline building areas only; no client integration or Overpass."""
import json
from collections import Counter
from pathlib import Path

import osmium
from city_config import ROOT, CENTER, PROJECTION, validate_city, region_paths

INPUT = ROOT / 'pipeline/world/source/nigeria-latest.osm.pbf'
PIPELINE_VERSION = 'building-world-v1-phase-a5'

KEEP = (
    'building', 'building:levels', 'building:min_level', 'height', 'min_height',
    'roof:shape', 'roof:levels', 'roof:height', 'roof:material', 'building:material',
    'name', 'amenity', 'shop', 'office', 'tourism', 'healthcare', 'leisure',
    'religion', 'denomination', 'school', 'university', 'addr:housenumber', 'addr:street',
)


def is_building(tags):
    return tags.get('building') not in (None, '', 'no')


def intersects(points, bounds):
    if not points:
        return False
    xs, ys = zip(*points)
    return not (max(xs) < bounds['west'] or min(xs) > bounds['east'] or
                max(ys) < bounds['south'] or min(ys) > bounds['north'])


class Relations(osmium.SimpleHandler):
    """Copy member IDs before area assembly; IDs enable reliable deduplication."""
    def __init__(self):
        super().__init__()
        self.records = {}
        self.members = set()

    def relation(self, relation):
        if not is_building(relation.tags):
            return
        members = [int(m.ref) for m in relation.members if m.type == 'w']
        self.records[int(relation.id)] = {'members': members, 'type': relation.tags.get('type')}
        self.members.update(members)


class Buildings(osmium.SimpleHandler):
    def __init__(self, city, relations=None):
        super().__init__()
        self.city = city
        self.bounds = city['bbox']
        self.relations = relations or Relations()
        self.elements = []
        self.local_members = set()
        self.local_ways = set()
        self.successful_relations = set()
        self.rejections = Counter()
        self.stats = Counter({'buildingWaysScanned': 0, 'regionBuildingWaysFound': 0})

    def way(self, way):
        data = read_way(way, self.relations)
        if data is not None:
            self.process_way(*data)

    def process_way(self, ident, building, points, closed, node_count):
        if building:
            self.stats['buildingWaysScanned'] += 1
            if self.stats['buildingWaysScanned'] % 500000 == 0:
                print(f"{self.city['displayName']}: building ways scanned {self.stats['buildingWaysScanned']:,}; "
                      f"assembled areas {len(self.elements):,}", flush=True)
        if not intersects(points, self.bounds):
            return
        self.local_members.add(ident)
        if building:
            self.local_ways.add(ident)
            self.stats['regionBuildingWaysFound'] += 1
            if len(points) != node_count:
                self.rejections['missing_node_location'] += 1
            elif not closed:
                self.rejections['open_building_way'] += 1

    def area(self, area):
        data = read_area(area, self.relations)
        if data is not None:
            self.process_area(*data)

    def process_area(self, ident, from_way, polygons, tags):
        if not polygons or not any(intersects(p[0], self.bounds) for p in polygons):
            return
        if not from_way:
            self.successful_relations.add(ident)
        self.elements.append({
            'id': f"{'way' if from_way else 'relation'}:{ident}",
            'polygons': polygons, 'tags': tags,
            **({'members': self.relations.records[ident]['members']} if not from_way else {}),
        })
        if len(self.elements) % 100000 == 0:
            print(f"{self.city['displayName']}: assembled building areas {len(self.elements):,}", flush=True)

    def payload(self):
        assembled_ways = {int(e['id'].split(':')[1]) for e in self.elements if e['id'].startswith('way:')}
        local_relations = {ident for ident, record in self.relations.records.items()
                           if any(member in self.local_members for member in record['members'])}
        local_relations.update(self.successful_relations)
        deferred = [{'id': f'relation:{ident}',
                     'reason': 'unsupported_relation_type' if self.relations.records[ident]['type'] != 'multipolygon'
                     else 'area_assembly_failed'}
                    for ident in sorted(local_relations - self.successful_relations)]
        # The builder deduplicates only AFTER geometry validation. A rejected relation
        # must not suppress an otherwise usable tagged member way.
        explicit_rejected = sum(self.rejections.values())
        missing = max(0, len(self.local_ways - assembled_ways) - explicit_rejected)
        if missing:
            self.rejections['way_area_assembly_failed'] += missing
        self.stats.update({
            'buildingRelationsScanned': len(self.relations.records),
            'regionBuildingRelationsFound': len(local_relations),
            'multipolygonBuildingsFound': len(self.successful_relations),
            'assembledBuildingWays': len(assembled_ways),
            'extractionRejectedWays': sum(self.rejections.values()),
            'deferredRelations': len(deferred),
        })
        return {
            'version': 1, 'pipelineVersion': PIPELINE_VERSION,
            'region': self.city['slug'], 'city': self.city['displayName'],
            'projection': PROJECTION['id'], 'center': CENTER, 'bounds': self.bounds,
            'tileSize': self.city['tileSize'],
            'source': 'Local Geofabrik Nigeria OSM PBF',
            'attribution': '\u00a9 OpenStreetMap contributors',
            'stats': dict(self.stats), 'rejectionReasons': dict(self.rejections),
            'deferredRelations': deferred,
            'elements': sorted(self.elements, key=lambda e: e['id']),
        }


def read_way(way, relations):
    building = is_building(way.tags)
    if not building and int(way.id) not in relations.members:
        return None
    points = [(n.location.lon, n.location.lat) for n in way.nodes if n.location.valid()]
    return int(way.id), building, points, way.is_closed(), len(way.nodes)


def read_area(area, relations):
    if not is_building(area.tags):
        return None
    ident, from_way = int(area.orig_id()), area.from_way()
    if not from_way and relations.records.get(ident, {}).get('type') != 'multipolygon':
        return None
    polygons = []
    try:
        for outer in area.outer_rings():
            rings = [[[n.lon, n.lat] for n in outer]]
            rings.extend([[n.lon, n.lat] for n in inner] for inner in area.inner_rings(outer))
            polygons.append(rings)
    except (osmium.InvalidLocationError, ValueError):
        return None
    return ident, from_way, polygons, {key: area.tags[key] for key in KEEP if key in area.tags}


class BatchBuildings(osmium.SimpleHandler):
    """One PBF scan and one geometry decode for any number of configured regions."""
    def __init__(self, handlers, relations):
        super().__init__()
        self.handlers = handlers
        self.relations = relations

    def way(self, way):
        data = read_way(way, self.relations)
        if data is not None:
            for handler in self.handlers:
                handler.process_way(*data)

    def area(self, area):
        data = read_area(area, self.relations)
        if data is not None:
            for handler in self.handlers:
                handler.process_area(*data)


def extract(cities, input_path=INPUT):
    cities = [validate_city(city) for city in cities]
    if not input_path.is_file():
        raise FileNotFoundError(f'Missing local Nigeria PBF: {input_path}')
    if len({city['slug'] for city in cities}) != len(cities):
        raise ValueError('Duplicate requested city')
    if any('buildings' not in city['enabledWorldLayers'] for city in cities):
        raise ValueError('Requested region does not enable buildings')
    print('CITYVERSE - REGION BUILDING EXTRACTION (offline data only)', flush=True)
    print(f'Source: {input_path}\nShared projection: {PROJECTION}', flush=True)
    for city in cities:
        print(f"Region {city['slug']}: {city['bbox']}", flush=True)
    relations = Relations()
    relations.apply_file(str(input_path))
    print(f'Building relations scanned: {len(relations.records):,}', flush=True)
    handlers = [Buildings(city, relations) for city in cities]
    BatchBuildings(handlers, relations).apply_file(str(input_path), locations=True, idx='flex_mem')
    for handler in handlers:
        payload = handler.payload()
        output = region_paths(handler.city)['source']
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('w', encoding='utf-8') as file:
            json.dump(payload, file, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        print(json.dumps({'region': handler.city['slug'], **payload['stats'],
                          'rejectionReasons': payload['rejectionReasons'], 'output': str(output)}, indent=2), flush=True)
    return handlers
