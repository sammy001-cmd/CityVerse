import json
from pathlib import Path
import osmium


ROOT = Path(__file__).resolve().parents[2]

INPUT = (
    ROOT
    / "pipeline"
    / "world"
    / "source"
    / "nigeria-latest.osm.pbf"
)

OUTPUT = (
    ROOT
    / "apps"
    / "client"
    / "public"
    / "data"
    / "city-road-source.json"
)


CENTER = {
    "lat": 7.3962,
    "lon": 3.8968,
}

# ~15 km CityVerse Ibadan map area
SOUTH = 7.26050
WEST = 3.76092
NORTH = 7.53190
EAST = 4.03267


ROAD_TYPES = {
    "motorway",
    "motorway_link",
    "trunk",
    "trunk_link",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "unclassified",
    "residential",
    "living_street",
    "service",
}


KEEP_TAGS = {
    "highway",
    "name",
    "ref",
    "oneway",
    "junction",
    "surface",
    "lanes",
    "maxspeed",
    "bridge",
    "tunnel",
    "access",
    "service",
}


class IbadanRoadHandler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()

        self.elements = []

        self.scanned_ways = 0
        self.kept_ways = 0


    def way(self, way):
        self.scanned_ways += 1

        highway = way.tags.get(
            "highway"
        )

        if highway not in ROAD_TYPES:
            return


        geometry = []
        node_ids = []
        inside = []


        for node in way.nodes:
            location = node.location

            if not location.valid():
                continue

            lat = location.lat
            lon = location.lon

            index = len(
                geometry
            )

            geometry.append({
                "lat": lat,
                "lon": lon,
            })

            node_ids.append(
                int(node.ref)
            )

            if (
                SOUTH <= lat <= NORTH
                and
                WEST <= lon <= EAST
            ):
                inside.append(
                    index
                )


        if (
            len(geometry) < 2
            or
            not inside
        ):
            return


        # Keep one real OSM node beyond each map boundary.
        # This helps maintain connectivity at tile/city edges.
        start = max(
            0,
            min(inside) - 1,
        )

        end = min(
            len(geometry) - 1,
            max(inside) + 1,
        )


        clipped_geometry = (
            geometry[start:end + 1]
        )

        clipped_nodes = (
            node_ids[start:end + 1]
        )


        if (
            len(clipped_geometry) < 2
        ):
            return


        tags = {}

        for key in KEEP_TAGS:
            value = way.tags.get(
                key
            )

            if value is not None:
                tags[key] = value


        self.elements.append({
            "type": "way",

            "id":
                int(way.id),

            "nodes":
                clipped_nodes,

            "tags":
                tags,

            "geometry":
                clipped_geometry,
        })

        self.kept_ways += 1


if not INPUT.exists():
    raise FileNotFoundError(
        f"Missing Nigeria PBF:\n{INPUT}"
    )


print("")
print(
    "CITYVERSE — IBADAN ROAD EXTRACTION"
)
print(
    "----------------------------------"
)
print(
    "Source:",
    INPUT
)
print(
    "Bounds:"
)
print(
    f"  SW: {SOUTH}, {WEST}"
)
print(
    f"  NE: {NORTH}, {EAST}"
)
print("")
print(
    "Scanning Nigeria OSM data..."
)
print(
    "This is an offline build step; "
    "the PBF will never be sent to players."
)
print("")


handler = IbadanRoadHandler()


handler.apply_file(
    str(INPUT),

    locations=True,

    idx="flex_mem",
)


payload = {
    "version":
        1,

    "generatedAt":
        None,

    "center":
        CENTER,

    "bounds": {
        "south":
            SOUTH,

        "west":
            WEST,

        "north":
            NORTH,

        "east":
            EAST,
    },

    "source":
        "OpenStreetMap / Geofabrik Nigeria extract",

    "elements":
        handler.elements,
}


OUTPUT.parent.mkdir(
    parents=True,
    exist_ok=True,
)


with OUTPUT.open(
    "w",
    encoding="utf-8",
) as file:
    json.dump(
        payload,
        file,

        ensure_ascii=False,

        separators=(
            ",",
            ":",
        ),
    )


print("")
print(
    "CITYVERSE IBADAN ROAD EXTRACTION COMPLETE"
)
print(
    "-----------------------------------------"
)
print(
    "OSM ways scanned:",
    handler.scanned_ways,
)
print(
    "Ibadan road ways:",
    handler.kept_ways,
)
print(
    "Output:",
    OUTPUT,
)
print("")