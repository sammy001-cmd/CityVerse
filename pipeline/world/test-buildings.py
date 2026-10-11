import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('extract', Path(__file__).with_name('extract-ibadan-buildings.py'))
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


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


def run(xml):
    with tempfile.TemporaryDirectory() as directory:
        file = Path(directory)/'fixture.osm'
        file.write_text(xml, encoding='utf-8')
        relations=extract.Relations()
        relations.apply_file(str(file))
        handler=extract.Buildings(relations)
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
        self.assertEqual(extract.road_coordinates(), (extract.CENTER, extract.BOUNDS))
        self.assertEqual(extract.CENTER, {'lat':7.3962,'lon':3.8968})
        self.assertFalse(extract.intersects([(0,0),(1,1)]))

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
        self.assertEqual(payload['stats']['ibadanBuildingWaysFound'], 0)


if __name__ == '__main__':
    unittest.main()
