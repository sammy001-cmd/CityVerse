import importlib.util
import tempfile
import unittest
from pathlib import Path

import building_extraction as extract
from city_config import load_city, validate_city, CENTER
CITY = load_city('ibadan')


def fixture(extra='', outer_tags='<tag k="building" v="yes"/>', relation_type='multipolygon'):
    nodes = [(3.89,7.39),(3.891,7.39),(3.891,7.391),(3.89,7.391),
             (3.8902,7.3902),(3.8908,7.3902),(3.8908,7.3908),(3.8902,7.3908),
             (3.895,7.395),(3.896,7.395),(3.896,7.396),(3.895,7.396)]
    xml = '<osm version="0.6">' + ''.join(f'<node id="{i+1}" lon="{lon}" lat="{lat}"/>' for i,(lon,lat) in enumerate(nodes))
    for ident,refs,tags in [(10,[1,2,3,4,1],outer_tags),(11,[5,6,7,8,5],''),
                            (12,[9,10,11,12,9],'<tag k="building" v="house"/>')]:
        xml += f'<way id="{ident}">' + ''.join(f'<nd ref="{r}"/>' for r in refs) + tags + '</way>'
    xml += f'<relation id="20"><member type="way" ref="10" role="outer"/><member type="way" ref="11" role="inner"/><tag k="type" v="{relation_type}"/><tag k="building" v="school"/><tag k="name" v="School"/>{extra}</relation></osm>'
    return xml


def run(xml, city=CITY):
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory)/'fixture.osm'
        file.write_text(xml, encoding='utf-8')
        relations=extract.Relations()
        relations.apply_file(str(file))
        handler=extract.Buildings(city, relations)
        handler.apply_file(str(file), locations=True)
        return handler.payload()


class ExtractionTest(unittest.TestCase):
    def test_closed_way_and_relation_hole_and_member_identity(self):
        payload=run(fixture())
        by_id={e['id']:e for e in payload['elements']}
        self.assertEqual(set(by_id), {'way:10','way:12','relation:20'})
        self.assertEqual(len(by_id['relation:20']['polygons'][0]), 2)
        self.assertEqual(by_id['relation:20']['members'], [10,11])
        self.assertEqual(by_id['relation:20']['tags']['name'], 'School')
        self.assertEqual(payload['stats']['buildingWaysScanned'], 2)
        self.assertEqual(payload['stats']['buildingRelationsScanned'], 1)
        self.assertEqual(payload['stats']['multipolygonBuildingsFound'], 1)
        self.assertEqual(payload['stats']['deferredRelations'], 0)

    def test_exact_tag_allowlist(self):
        extras=''.join(f'<tag k="{key}" v="example"/>' for key in extract.KEEP if key not in {'building','name'})
        extras+='<tag k="addr:postcode" v="omit"/><tag k="school:unknown" v="omit"/><tag k="source" v="omit"/>'
        relation=next(e for e in run(fixture(extras))['elements'] if e['id']=='relation:20')
        self.assertEqual(set(relation['tags']), set(extract.KEEP))

    def test_broken_relation_is_deferred_and_tagged_way_survives(self):
        xml=fixture().replace('ref="11" role="inner"', 'ref="999" role="inner"')
        payload=run(xml)
        self.assertNotIn('relation:20', {e['id'] for e in payload['elements']})
        self.assertIn('way:10', {e['id'] for e in payload['elements']})
        self.assertEqual(payload['stats']['deferredRelations'], 1)
        self.assertEqual(payload['deferredRelations'][0]['reason'], 'area_assembly_failed')

    def test_open_building_way_is_rejected(self):
        xml=fixture().replace('<nd ref="12"/><nd ref="9"/>','<nd ref="12"/>')
        payload=run(xml)
        self.assertEqual(payload['rejectionReasons']['open_building_way'], 1)
        self.assertEqual(payload['stats']['extractionRejectedWays'], 1)
        self.assertNotIn('way:12', {e['id'] for e in payload['elements']})

    def test_unsupported_relation_is_reported(self):
        payload=run(fixture(relation_type='building'))
        self.assertEqual(payload['deferredRelations'], [{'id':'relation:20','reason':'unsupported_relation_type'}])

    def test_bounds_and_center_use_road_authority(self):
        import ast
        tree=ast.parse(Path(__file__).with_name('extract-ibadan-roads.py').read_text(encoding='utf-8'))
        values={target.id:ast.literal_eval(statement.value) for statement in tree.body
                if isinstance(statement,ast.Assign) for target in statement.targets
                if isinstance(target,ast.Name) and target.id in {'CENTER','SOUTH','WEST','NORTH','EAST'}}
        self.assertEqual(values['CENTER'], CENTER)
        self.assertEqual({k.lower():values[k] for k in ('SOUTH','WEST','NORTH','EAST')}, CITY['bbox'])
        self.assertFalse(extract.intersects([(0,0),(1,1)], CITY['bbox']))

    def test_relation_assembles_split_outer_ways(self):
        xml=fixture().replace(
            '<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/><nd ref="4"/><nd ref="1"/><tag k="building" v="yes"/></way>',
            '<way id="10"><nd ref="1"/><nd ref="2"/><nd ref="3"/></way>'
            '<way id="13"><nd ref="1"/><nd ref="4"/><nd ref="3"/></way>')
        xml=xml.replace('<member type="way" ref="10" role="outer"/>',
                        '<member type="way" ref="10" role="outer"/><member type="way" ref="13" role="outer"/>')
        # libosmium expects OSM entities ordered by ID, as they are in the PBF.
        way13='<way id="13"><nd ref="1"/><nd ref="4"/><nd ref="3"/></way>'
        xml=xml.replace(way13, '').replace('<relation id="20">', way13+'<relation id="20">')
        payload=run(xml)
        relation=next(e for e in payload['elements'] if e['id']=='relation:20')
        self.assertEqual(len(relation['polygons'][0][0]), 5)
        self.assertEqual(relation['members'], [10,13,11])

    def test_missing_way_location_is_reported(self):
        xml=fixture().replace('<nd ref="12"/>','<nd ref="999"/>')
        payload=run(xml)
        self.assertEqual(payload['rejectionReasons']['missing_node_location'], 1)
        self.assertNotIn('way:12', {e['id'] for e in payload['elements']})

    def test_non_buildings_and_outside_bounds_are_not_extracted(self):
        xml=fixture().replace('v="house"','v="no"').replace('lon="3.89','lon="2.89')
        payload=run(xml)
        self.assertEqual(payload['elements'], [])
        self.assertEqual(payload['stats']['regionBuildingWaysFound'], 0)


class RegionConfigTest(unittest.TestCase):
    def test_both_cities_use_one_extractor_and_shared_projection(self):
        import xml.etree.ElementTree as ET
        other=load_city('ogbomoso')
        tree=ET.fromstring(fixture())
        for node in tree.findall('node'):
            node.set('lat', str(float(node.get('lat')) + other['build']['focus']['lat'] - 7.39))
            node.set('lon', str(float(node.get('lon')) + other['build']['focus']['lon'] - 3.89))
        a=run(fixture(),CITY)
        b=run(ET.tostring(tree,encoding='unicode'),other)
        self.assertEqual(len(a['elements']), len(b['elements']))
        self.assertEqual(a['projection'], b['projection'])
        self.assertEqual(a['center'], b['center'])
        self.assertEqual(b['region'], 'ogbomoso')
        self.assertEqual(b['stats']['multipolygonBuildingsFound'],1)

    def test_batch_scan_routes_only_matching_regions(self):
        other=load_city('ogbomoso')
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'fixture.osm'
            file.write_text(fixture(),encoding='utf-8')
            relations=extract.Relations();relations.apply_file(str(file))
            handlers=[extract.Buildings(city,relations) for city in [CITY,other]]
            extract.BatchBuildings(handlers,relations).apply_file(str(file),locations=True)
        self.assertEqual(len(handlers[0].elements),3)
        self.assertEqual(handlers[1].elements,[])
        self.assertEqual(handlers[0].stats['buildingWaysScanned'],handlers[1].stats['buildingWaysScanned'])

    def test_config_validation_rejects_bad_city_inputs(self):
        import copy
        for slug in ['ibadan','ogbomoso']:
            self.assertEqual(validate_city(load_city(slug))['slug'],slug)
        for patch in [{'slug':'../bad'},{'projection':'different'},{'tileSize':True},
                      {'bbox':{'south':0,'north':float('nan'),'west':0,'east':1}},
                      {'enabledWorldLayers':['buildings','buildings']},
                      {'build':{'roadAnalysisDirectory':'../outside'}}]:
            config=copy.deepcopy(CITY);config.update(patch)
            with self.assertRaises(ValueError):validate_city(config)


if __name__ == '__main__':
    unittest.main()
