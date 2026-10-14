"""Compatibility entry point. All extraction logic lives in building_extraction.py."""
from building_extraction import extract
from city_config import load_city

if __name__ == '__main__':
    extract([load_city('ibadan')])
