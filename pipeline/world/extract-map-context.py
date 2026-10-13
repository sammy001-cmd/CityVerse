"""Offline map-only extraction. No routing graph, raw PBF, or building layer output."""
import json
import math
import osmium
import argparse
import time
from city_config import ROOT, PROJECTION, load_city

SOURCE = ROOT / 'pipeline/world/source/nigeria-latest.osm.pbf'
CITIES = []
ORIGIN = PROJECTION['origin']
ROAD_TYPES = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
              'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential',
              'unclassified', 'living_street', 'service', 'pedestrian', 'footway', 'cycleway', 'path', 'steps'}
KNOWN = ('cocoa house', 'college hospital', 'university of ibadan', 'adamasingba', 'agodi',
         'lautech', 'ladoke akintola')


def context(tags):
    land, leisure = tags.get('landuse'), tags.get('leisure')
    if tags.get('natural') == 'water' or tags.get('waterway') == 'riverbank':
        return 'water'
    if leisure in ('park', 'garden', 'recreation_ground', 'nature_reserve', 'pitch', 'sports_centre', 'stadium'):
        return 'park'
    if tags.get('amenity') in ('university', 'college', 'school', 'hospital') or land in ('education', 'institutional'):
        return 'institution'
    return land if land in ('commercial', 'retail', 'residential', 'industrial') else None


def category(tags):
    name = tags.get('name', '')
    if not name:
        return None
    amenity = tags.get('amenity')
    if amenity in ('hospital', 'clinic', 'pharmacy', 'bank', 'atm', 'fuel', 'school', 'university',
                   'police', 'fire_station', 'marketplace', 'townhall', 'library', 'bus_station', 'taxi'):
        return {'marketplace': 'market', 'townhall': 'government', 'bus_station': 'transport', 'taxi': 'transport'}.get(amenity, amenity)
    if amenity in ('restaurant', 'cafe', 'fast_food', 'bar'):
        return 'food'
    if tags.get('healthcare') in ('hospital', 'clinic', 'pharmacy'):
        return tags['healthcare']
    if tags.get('tourism') in ('hotel', 'motel', 'guest_house'):
        return 'hotel'
    if tags.get('tourism') in ('attraction', 'museum') or tags.get('historic'):
        return 'landmark'
    if tags.get('shop'):
        return 'mall' if tags['shop'] == 'mall' else 'supermarket' if tags['shop'] == 'supermarket' else 'shop'
    if tags.get('leisure') in ('park', 'garden', 'stadium', 'sports_centre'):
        return 'sports' if tags['leisure'] in ('stadium', 'sports_centre') else 'park'
    if tags.get('highway') == 'bus_stop' or tags.get('public_transport'):
        return 'transport'
    if tags.get('highway'):
        return None
    return 'landmark' if any(token in name.lower() for token in KNOWN) else None


def project(lat, lon):
    return [round((lon-ORIGIN['lon'])*PROJECTION['metresPerDegreeLon']*math.cos(math.radians(ORIGIN['lat']))),
            round(-(lat-ORIGIN['lat'])*PROJECTION['metresPerDegreeLat'])]


def intersects(coords, city):
    b = city['bbox']
    return coords and max(p[0] for p in coords) >= b['south'] and min(p[0] for p in coords) <= b['north'] \
        and max(p[1] for p in coords) >= b['west'] and min(p[1] for p in coords) <= b['east']


def point_in(lat, lon, city):
    b = city['bbox']
    return b['south'] <= lat <= b['north'] and b['west'] <= lon <= b['east']


def metadata(identity, tags, lat, lon, cat):
    x, z = project(lat, lon)
    importance = 3 if cat == 'landmark' or any(t in tags.get('name', '').lower() for t in KNOWN) else 2 if cat in ('hospital', 'university', 'sports', 'mall', 'market') else 1
    address = ' '.join(tags.get(k, '') for k in ('addr:housenumber', 'addr:street', 'addr:city')).strip() or None
    return {'id': 'osm:'+identity, 'name': tags.get('name'), 'category': cat, 'x': x, 'z': z,
            'address': address, 'phone': tags.get('contact:phone', tags.get('phone')),
            'website': tags.get('contact:website', tags.get('website')), 'openingHours': tags.get('opening_hours'),
            'aliases': [tags[k] for k in ('short_name', 'alt_name', 'official_name') if tags.get(k)],
            'importance': importance, 'source': {'provider': 'OpenStreetMap', 'identity': identity}}


class Relations(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.records = []
        self.members = set()

    def relation(self, r):
        tags = dict(r.tags)
        kind = context(tags)
        if tags.get('type') != 'multipolygon' or not kind:
            return
        members = [(m.ref, m.role or 'outer') for m in r.members if m.type == 'w']
        self.records.append((r.id, tags, kind, members))
        self.members.update(m[0] for m in members)


def join_rings(parts):
    remaining = [list(p) for p in parts if len(p) >= 2]
    rings = []
    while remaining:
        chain = remaining.pop()
        while chain[0][0] != chain[-1][0]:
            match = next(((i, p) for i, p in enumerate(remaining) if p[0][0] == chain[-1][0] or p[-1][0] == chain[-1][0]), None)
            if not match:
                break
            i, p = match
            remaining.pop(i)
            if p[-1][0] == chain[-1][0]:
                p.reverse()
            chain.extend(p[1:])
        if len(chain) >= 4 and chain[0][0] == chain[-1][0]:
            rings.append([p[1] for p in chain])
    return rings


def contains(point, ring):
    inside = False
    for a, b in zip(ring, ring[1:]):
        if (a[1] > point[1]) != (b[1] > point[1]) and point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]:
            inside = not inside
    return inside


class MapContext(osmium.SimpleHandler):
    def __init__(self, relations):
        super().__init__()
        self.relations = relations
        self.parts = {}
        self.ways_seen = 0
        self.started = time.perf_counter()
        self.data = {c['slug']: {'region': c['slug'], 'roads': [], 'areas': [], 'rivers': [], 'places': [], 'pois': []} for c in CITIES}

    def node(self, n):
        if 'name' not in n.tags:
            return
        tags = dict(n.tags)
        cat, place = category(tags), tags.get('place')
        if not tags.get('name') or not (cat or place in ('city', 'town', 'suburb', 'neighbourhood', 'quarter', 'village')):
            return
        for city in CITIES:
            if not point_in(n.location.lat, n.location.lon, city):
                continue
            record = metadata('node:'+str(n.id), tags, n.location.lat, n.location.lon, cat or 'neighborhood')
            if cat:
                self.data[city['slug']]['pois'].append(record)
            if place:
                self.data[city['slug']]['places'].append({**record, 'category': 'neighborhood', 'placeType': place})

    def way(self, w):
        self.ways_seen += 1
        if self.ways_seen % 250000 == 0:
            print(f'Map pass: {self.ways_seen:,} ways, {time.perf_counter()-self.started:.1f}s', flush=True)
        tags = dict(w.tags)
        road = tags.get('highway') in ROAD_TYPES
        kind, cat = context(tags), category(tags)
        river = tags.get('waterway') in ('river', 'stream', 'canal', 'drain')
        if not (road or kind or river or cat and tags.get('name') or w.id in self.relations.members):
            return
        try:
            coords = [[n.lat, n.lon] for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if len(coords) < 2:
            return
        if w.id in self.relations.members:
            self.parts[w.id] = [(n.ref, p) for n, p in zip(w.nodes, coords)]
        cities = [c for c in CITIES if intersects(coords, c)]
        if not cities:
            return
        points = [project(*p) for p in coords]
        for city in cities:
            data = self.data[city['slug']]
            if road:
                data['roads'].append({'id': 'way:'+str(w.id), 'type': tags['highway'], 'name': tags.get('name'), 'points': points})
            if river:
                data['rivers'].append({'id': 'way:'+str(w.id), 'kind': 'river', 'name': tags.get('name'), 'points': points})
            if kind and points[0] == points[-1] and len(points) >= 4:
                data['areas'].append({'id': 'way:'+str(w.id), 'kind': kind, 'name': tags.get('name'), 'rings': [points]})
            if cat and tags.get('name'):
                lat = sum(p[0] for p in coords)/len(coords)
                lon = sum(p[1] for p in coords)/len(coords)
                if point_in(lat, lon, city):
                    data['pois'].append(metadata('way:'+str(w.id), tags, lat, lon, cat))

    def finish(self):
        for identity, tags, kind, members in self.relations.records:
            outer = join_rings([self.parts[m] for m, role in members if role != 'inner' and m in self.parts])
            inner = join_rings([self.parts[m] for m, role in members if role == 'inner' and m in self.parts])
            for ring in outer:
                for city in CITIES:
                    if not intersects(ring, city):
                        continue
                    rings = [ring]+[h for h in inner if contains(h[0], ring)]
                    self.data[city['slug']]['areas'].append({'id': 'relation:'+str(identity), 'kind': kind,
                        'name': tags.get('name'), 'rings': [[project(*p) for p in r] for r in rings]})
                    cat = category(tags)
                    if cat and tags.get('name'):
                        lat, lon = sum(p[0] for p in ring)/len(ring), sum(p[1] for p in ring)/len(ring)
                        if point_in(lat, lon, city):
                            self.data[city['slug']]['pois'].append(metadata('relation:'+str(identity), tags, lat, lon, cat))
        for slug, data in self.data.items():
            output = ROOT / 'data/generated/city-map-v2' / (slug+'-source.json')
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
            print(json.dumps({'region': slug, **{k: len(data[k]) for k in ('roads', 'areas', 'rivers', 'places', 'pois')}}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--regions', nargs='+', default=['ibadan', 'ogbomoso'])
    parser.add_argument('--location-index', choices=['sparse_mem_array', 'sparse_file_array', 'flex_mem'], default='sparse_mem_array')
    args = parser.parse_args()
    CITIES = [load_city(slug) for slug in args.regions]
    print('Scanning local PBF for map multipolygons', flush=True)
    relations = Relations()
    relations.apply_file(str(SOURCE))
    print('Extracting region roads, context and places (no routing graph)', flush=True)
    handler = MapContext(relations)
    # Filter unnamed nodes natively after the location handler; untagged way
    # members still retain their coordinates for complete multipolygon rings.
    handler.apply_file(str(SOURCE), locations=True, idx=args.location_index,
                       filters=[osmium.filter.KeyFilter('name').enable_for(osmium.osm.NODE)])
    handler.finish()
