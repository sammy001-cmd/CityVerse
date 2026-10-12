"""Offline multi-city CLI; repeat --city to share a single national PBF scan."""
import argparse
from pathlib import Path
from building_extraction import INPUT, extract
from city_config import load_city

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--city', action='append', required=True, help='Configured region slug (repeatable)')
    parser.add_argument('--input', type=Path, default=INPUT, help='Local build-time PBF')
    args = parser.parse_args()
    extract([load_city(slug) for slug in args.city], args.input)
