import json
import sys
from pathlib import Path
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

root = Path(__file__).resolve().parents[2]
folder = Path(sys.argv[1]) if len(sys.argv) > 1 else root / ".world-assets/staging/road-world-v4-subset"
manifest = json.loads((folder / "manifest.json").read_text())
tiles = {}
ids = set()
invalid = []
for key in manifest["tiles"]:
    data = json.loads((folder / f"{key}.json").read_text())
    tx, tz = map(int, key.split("_"))
    features = []
    for feature in data["features"]:
        p = Polygon([(x+tx*manifest["tileSize"],z+tz*manifest["tileSize"]) for x,z in feature["outer"]], [[(x+tx*manifest["tileSize"],z+tz*manifest["tileSize"]) for x,z in ring] for ring in feature["holes"]])
        if not p.is_valid or p.area <= 0: invalid.append((key, feature.get("ids")))
        features.append(p)
        ids.update(feature["ids"])
    tiles[key] = unary_union(features)
seams = []
for key, geom in tiles.items():
    tx, tz = map(int, key.split("_"))
    right = tiles.get(f"{tx+1}_{tz}")
    if right:
        a = geom.intersection(box((tx+1)*manifest["tileSize"], tz*manifest["tileSize"], (tx+1)*manifest["tileSize"], (tz+1)*manifest["tileSize"]))
        b = right.intersection(box((tx+1)*manifest["tileSize"], tz*manifest["tileSize"], (tx+1)*manifest["tileSize"], (tz+1)*manifest["tileSize"]))
        if a.symmetric_difference(b).length > 1e-6: seams.append((key, f"{tx+1}_{tz}"))
    down = tiles.get(f"{tx}_{tz+1}")
    if down:
        edge = (tz+1)*manifest["tileSize"]
        a = geom.intersection(box(tx*manifest["tileSize"], edge, (tx+1)*manifest["tileSize"], edge))
        b = down.intersection(box(tx*manifest["tileSize"], edge, (tx+1)*manifest["tileSize"], edge))
        if a.symmetric_difference(b).length > 1e-6: seams.append((key, f"{tx}_{tz+1}"))
seams_checked = sum(1 for key in tiles for neighbor in (f"{int(key.split('_')[0])+1}_{key.split('_')[1]}", f"{key.split('_')[0]}_{int(key.split('_')[1])+1}") if neighbor in tiles)
print(json.dumps({"valid":not invalid and not seams,"invalidPolygonCount":len(invalid),"seamMismatchCount":len(seams),"seamsChecked":seams_checked,"tileCount":len(tiles),"polygonCount":manifest["polygons"],"unionComponents":manifest["unionComponents"],"worldSourceWayIds":len(ids),"excludedWayCount":manifest["excludedWays"]},indent=2))
if invalid or seams: raise SystemExit(1)
