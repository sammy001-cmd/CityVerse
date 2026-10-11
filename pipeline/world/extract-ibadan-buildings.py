"""Phase A: offline building areas only; no client integration or Overpass."""
import ast
import json
from collections import Counter
from pathlib import Path

import osmium

ROOT = Path(__file__).resolve().parents[2]
INPUT = ROOT / 'pipeline/world/source/nigeria-latest.osm.pbf'
OUTPUT = ROOT / 'data/generated/ibadan-buildings-source.json'


def road_coordinates():
    """Read constants without importing the road extractor (which runs on import)."""
    wanted = {'CENTER', 'SOUTH', 'WEST', 'NORTH', 'EAST'}
    values = {}
    tree = ast.parse(Path(__file__).with_name('extract-ibadan-roads.py').read_text(encoding='utf-8'))
    for statement in tree.body:
        if isinstance(statement, ast.Assign):
            for target in statement.targets:
                if isinstance(target, ast.Name) and target.id in wanted:
                    values[target.id] = ast.literal_eval(statement.value)
    if set(values) != wanted:
        raise ValueError('Authoritative road coordinate constants are missing')
    return values['CENTER'], {key.lower(): values[key] for key in sorted(wanted - {'CENTER'})}


CENTER, BOUNDS = road_coordinates()
KEEP = (
    'building', 'building:levels', 'building:min_level', 'height', 'min_height',
    'roof:shape', 'roof:levels', 'roof:height', 'roof:material', 'building:material',
    'name', 'amenity', 'shop', 'office', 'tourism', 'healthcare', 'leisure',
    'religion', 'denomination', 'school', 'university', 'addr:housenumber', 'addr:street',
)


def is_building(tags):
    return tags.get('building') not in (None, '', 'no')


def intersects(points):
    if not points:
        return False
    xs, ys = zip(*points)
    return not (max(xs) < BOUNDS['west'] or min(xs) > BOUNDS['east'] or
                max(ys) < BOUNDS['south'] or min(ys) > BOUNDS['north'])


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
    def __init__(self, relations=None):
        super().__init__()
        self.relations = relations or Relations()
        self.elements = []
        self.local_members = set()
        self.local_ways = set()
        self.successful_relations = set()
        self.rejections = Counter()
        self.stats = Counter({'buildingWaysScanned': 0, 'ibadanBuildingWaysFound': 0})

    def way(self, way):
        building = is_building(way.tags)
        if building:
            self.stats['buildingWaysScanned'] += 1
            if self.stats['buildingWaysScanned'] % 500000 == 0:
                print(f"Building ways scanned: {self.stats['buildingWaysScanned']:,}; "
                      f"Ibadan assembled areas: {len(self.elements):,}", flush=True)
        if not building and int(way.id) not in self.relations.members:
            return
        points = [(node.location.lon, node.location.lat)
                  for node in way.nodes if node.location.valid()]
        if not intersects(points):
            return
        self.local_members.add(int(way.id))
        if building:
            self.local_ways.add(int(way.id))
            self.stats['ibadanBuildingWaysFound'] += 1
            if len(points) != len(way.nodes):
                self.rejections['missing_node_location'] += 1
            elif not way.is_closed():
                self.rejections['open_building_way'] += 1

    def area(self, area):
        if not is_building(area.tags):
            return
        ident = int(area.orig_id())
        from_way = area.from_way()
        if not from_way and self.relations.records.get(ident, {}).get('type') != 'multipolygon':
            return
        polygons = []
        try:
            for outer in area.outer_rings():
                rings = [[[node.lon, node.lat] for node in outer]]
                rings.extend([[node.lon, node.lat] for node in inner]
                             for inner in area.inner_rings(outer))
                polygons.append(rings)
        except (osmium.InvalidLocationError, ValueError):
            return  # Accounted for as an unassembled way/relation at finalization.
        if not polygons or not any(intersects(p[0]) for p in polygons):
            return
        # Keep whole buildings, including parts beyond the bbox; never clip an outer or hole.
        if not from_way:
            self.successful_relations.add(ident)
        self.elements.append({
            'id': f"{'way' if from_way else 'relation'}:{ident}",
            'polygons': polygons,
            'tags': {key: area.tags[key] for key in KEEP if key in area.tags},
            **({'members': self.relations.records[ident]['members']} if not from_way else {}),
        })
        if len(self.elements) % 100000 == 0:
            print(f'Ibadan assembled building areas: {len(self.elements):,}', flush=True)

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
            'ibadanBuildingRelationsFound': len(local_relations),
            'multipolygonBuildingsFound': len(self.successful_relations),
            'assembledBuildingWays': len(assembled_ways),
            'extractionRejectedWays': sum(self.rejections.values()),
            'deferredRelations': len(deferred),
        })
        return {
            'version': 1, 'pipelineVersion': 'building-world-v1-phase-a',
            'city': 'Ibadan', 'center': CENTER, 'bounds': BOUNDS,
            'source': 'Local Geofabrik Nigeria OSM PBF',
            'attribution': '\u00a9 OpenStreetMap contributors',
            'stats': dict(self.stats), 'rejectionReasons': dict(self.rejections),
            'deferredRelations': deferred,
            'elements': sorted(self.elements, key=lambda e: e['id']),
        }


def extract(input_path=INPUT, output_path=OUTPUT):
    if not input_path.is_file():
        raise FileNotFoundError(f'Missing local Nigeria PBF: {input_path}')
    print('CITYVERSE - BUILDING WORLD V1 PHASE A (offline data only)', flush=True)
    print(f'Source: {input_path}\nOrigin: {CENTER}\nBounds: {BOUNDS}', flush=True)
    relations = Relations()
    relations.apply_file(str(input_path))
    print(f'Building relations scanned: {len(relations.records):,}', flush=True)
    handler = Buildings(relations)
    handler.apply_file(str(input_path), locations=True, idx='flex_mem')
    payload = handler.payload()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('w', encoding='utf-8') as file:
        json.dump(payload, file, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    print(json.dumps({**payload['stats'], 'rejectionReasons': payload['rejectionReasons'],
                      'output': str(output_path)}, indent=2), flush=True)
    return payload


if __name__ == '__main__':
    extract()
