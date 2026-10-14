"""Validated region configuration shared by all offline building extractors."""
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = Path(__file__).with_name('cities')
PROJECTION = json.loads(Path(__file__).with_name('projection.json').read_text(encoding='utf-8'))
CENTER = PROJECTION['origin']
if (PROJECTION['version'] != 1 or PROJECTION['units'] != 'metres'
        or PROJECTION['axes'] != {'x': 'east', 'z': 'south'}
        or not all(isinstance(CENTER.get(k), (int, float)) and math.isfinite(CENTER[k])
                   and abs(CENTER[k]) <= limit for k, limit in [('lat', 90), ('lon', 180)])
        or not all(isinstance(PROJECTION.get(k), (int, float)) and math.isfinite(PROJECTION[k])
                   and PROJECTION[k] > 0 for k in ['metresPerDegreeLat', 'metresPerDegreeLon', 'quantization'])):
    raise ValueError('Invalid shared world projection')


def validate_city(config):
    if not isinstance(config, dict) or not isinstance(config.get('slug'), str) or not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', config['slug']):
        raise ValueError('Invalid city slug')
    if 'origin' in config or 'center' in config:
        raise ValueError('City cannot override the shared world origin')
    allowed = {'slug', 'displayName', 'country', 'countryCode', 'state', 'bbox', 'projection', 'tileSize', 'enabledWorldLayers', 'build'}
    if set(config) - allowed:
        raise ValueError('Unsupported city configuration property')
    for key in ('displayName', 'country', 'countryCode', 'state'):
        if not isinstance(config.get(key), str) or not config[key].strip():
            raise ValueError(f'Invalid city {key}')
    if not re.fullmatch(r'[A-Z]{3}', config['countryCode']):
        raise ValueError('Invalid country code')
    b = config.get('bbox', {})
    if not isinstance(b, dict) or set(b) != {'south', 'west', 'north', 'east'} or not all(isinstance(b.get(k), (int, float)) and not isinstance(b.get(k), bool) and math.isfinite(b[k]) for k in ('south', 'west', 'north', 'east')):
        raise ValueError('Invalid city bbox')
    if not (-90 <= b['south'] < b['north'] <= 90 and -180 <= b['west'] < b['east'] <= 180):
        raise ValueError('Invalid city bbox')
    if config.get('projection') != PROJECTION['id']:
        raise ValueError('City must reference the shared projection')
    size = config.get('tileSize')
    if not isinstance(size, int) or isinstance(size, bool) or not 10 <= size <= 10000:
        raise ValueError('Invalid city tile size')
    layers = config.get('enabledWorldLayers')
    if not isinstance(layers, list) or not layers or not all(isinstance(l, str) and l in ('buildings', 'roads', 'terrain', 'pois', 'navigation') for l in layers) or len(set(layers)) != len(layers):
        raise ValueError('Invalid enabled world layers')
    build = config.get('build', {})
    if not isinstance(build, dict):
        raise ValueError('Invalid build metadata')
    road_path = build.get('roadAnalysisDirectory')
    if road_path is not None and (not isinstance(road_path, str) or Path(road_path).is_absolute() or '..' in re.split(r'[\\/]', road_path)):
        raise ValueError('Road analysis path must stay within the project')
    return config


def load_city(slug):
    if not isinstance(slug, str) or not re.fullmatch(r'[a-z][a-z0-9]*(?:-[a-z0-9]+)*', slug):
        raise ValueError('Invalid city slug')
    config = validate_city(json.loads((DIRECTORY / f'{slug}.json').read_text(encoding='utf-8')))
    if config['slug'] != slug:
        raise ValueError('City slug and config filename disagree')
    return config


def region_paths(city):
    slug = validate_city(city)['slug']
    base = ROOT / 'data/generated/world' / slug
    return {'source': base / 'buildings-source.json', 'report': base / 'buildings-report.json',
            'output': ROOT / 'apps/client/public/data/world' / slug / 'buildings'}
