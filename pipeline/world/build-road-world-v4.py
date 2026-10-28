"""Offline V4 road surface builder. Requires Shapely 2.x.

Changes from the prototype:
  * junction discs at every shared OSM node, so ways meeting at an angle
    overlap instead of leaving notches at flat caps
  * morphological closing (--fillet) rounds concave junction corners
  * two-pass bounded corner cutting on centerlines (junction nodes stay fixed)
  * smoother round joins (quad_segs=8)
  * polygon boundaries are densified (--segment) so terrain draping follows
    hills instead of one long triangle cutting through the ground
  * degenerate / duplicate vertices are removed before writing tiles
"""
import argparse
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path

from shapely import segmentize, union_all
from shapely.geometry import LineString, Point, box
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "apps/client/public/data/city-road-source.json"
OUT = ROOT / ".world-assets/staging/road-world-v4-subset"
CENTER = (7.3962, 3.8968)
TILE = 250
CLASSES = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street", "service"}
DEFAULTS = {"service": 3.6, "residential": 6.0, "living_street": 6.0, "unclassified": 6.0, "tertiary": 7.2, "tertiary_link": 7.2, "secondary": 8.0, "secondary_link": 8.0, "primary": 10.0, "primary_link": 9.0, "trunk": 10.0, "trunk_link": 9.0, "motorway": 14.0, "motorway_link": 10.0}
LANE = {"motorway": 3.6, "trunk": 3.5, "primary": 3.4, "secondary": 3.2, "tertiary": 3.0, "residential": 2.8, "living_street": 2.8, "unclassified": 2.8, "service": 2.7}
QUAD = 8  # segments per quarter circle for joins, discs and fillets


def project(point):
    return ((point["lon"] - CENTER[1]) * 111320 * math.cos(math.radians(CENTER[0])), -(point["lat"] - CENTER[0]) * 110540)


def width_for(tags, road_type):
    raw = str(tags.get("width", "")).strip().lower().replace(",", ".")
    try:
        is_feet = raw.endswith(("ft", "feet", "foot", "'"))
        value = float(raw.removesuffix("feet").removesuffix("foot").removesuffix("ft").removesuffix("'").removesuffix("m").strip())
        if is_feet: value *= 0.3048
        if 2.5 <= value <= 40: return value, "osm-width"
    except ValueError:
        pass
    try:
        lanes = int(tags.get("lanes", ""))
        lane = LANE.get(road_type.removesuffix("_link"), 3.0)
        if 1 <= lanes <= 10: return max(2.8, min(36.0, lanes * lane)), "osm-lanes"
    except ValueError:
        pass
    return DEFAULTS[road_type], "class-default"


def bounded_smooth(points, protect, max_deviation=0.5, passes=2):
    """Chaikin-style corner cutting. Endpoints and junction nodes never move.
    Each pass moves the curve at most max_deviation from the corner it cuts."""
    pts = [(p, i in protect) for i, p in enumerate(points)]
    for _ in range(passes):
        if len(pts) < 3:
            break
        out = [pts[0]]
        for i in range(1, len(pts) - 1):
            (p, fixed), (a, _), (b, _) = pts[i], pts[i - 1], pts[i + 1]
            la, lb = math.dist(p, a), math.dist(p, b)
            if fixed or min(la, lb) < .5:
                out.append(pts[i])
                continue
            cut = min(.25, max_deviation / max(la, lb, 1e-6))
            out.append(((p[0] * (1 - cut) + a[0] * cut, p[1] * (1 - cut) + a[1] * cut), False))
            out.append(((p[0] * (1 - cut) + b[0] * cut, p[1] * (1 - cut) + b[1] * cut), False))
        out.append(pts[-1])
        pts = out
    return [p for p, _ in pts]


def polygons(geom):
    if geom.is_empty: return []
    if geom.geom_type == "Polygon": return [geom]
    if hasattr(geom, "geoms"):
        return [p for g in geom.geoms for p in polygons(g)]
    return []


def local_ring(coords, tx, tz):
    """Tile-local ring: rounded, no repeated vertices, None if degenerate."""
    out = []
    for x, z in list(coords)[:-1]:
        pt = [round(x - tx * TILE, 2), round(z - tz * TILE, 2)]
        if not out or pt != out[-1]:
            out.append(pt)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--center", nargs=2, type=float, default=[0, 0], metavar=("X", "Z"))
    parser.add_argument("--radius", type=float, default=700)
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--fillet", type=float, default=2.5,
                        help="metres; rounds concave junction corners and fills gaps narrower than 2x this. 0 disables")
    parser.add_argument("--segment", type=float, default=6.0,
                        help="max boundary segment length in metres, so terrain draping follows hills")
    args = parser.parse_args()
    started = time.perf_counter()
    source = json.loads(args.source.read_text(encoding="utf8"))
    node_use = Counter(str(n) for way in source.get("elements", []) for n in way.get("nodes", []))
    window = box(args.center[0]-args.radius, args.center[1]-args.radius, args.center[0]+args.radius, args.center[1]+args.radius)
    records, excluded, widths = [], Counter(), Counter()
    excluded_ids = defaultdict(list)
    source_by_class = Counter()
    for way in source.get("elements", []):
        wid = str(way.get("id", "")); tags = way.get("tags") or {}; road_type = tags.get("highway")
        source_by_class[road_type or "missing-highway"] += 1
        if road_type not in CLASSES: excluded["unsupported-class"] += 1; excluded_ids["unsupported-class"].append(wid); continue
        if len(way.get("geometry") or []) < 2: excluded["missing-or-short-geometry"] += 1; excluded_ids["missing-or-short-geometry"].append(wid); continue
        width, width_source = width_for(tags, road_type)
        source_points = [project(p) for p in way["geometry"]]
        protected = {i for i, node in enumerate(way.get("nodes", [])) if node_use[str(node)] > 1}
        points = bounded_smooth(source_points, protected)
        line = LineString(points)
        if line.is_empty or line.length < .1: excluded["degenerate-centerline"] += 1; excluded_ids["degenerate-centerline"].append(wid); continue
        if not line.intersects(window.buffer(width/2+2)): excluded["outside-subset-window"] += 1; excluded_ids["outside-subset-window"].append(wid); continue
        records.append({"wayId":wid,"type":road_type,"width":width,"widthSource":width_source,"line":line,
                        "centerline":source_points,"nodes":[str(n) for n in way.get("nodes", [])]})
        widths[road_type] += 1
    if not records: raise RuntimeError("Subset window selected no roads")

    # Junction discs: one per shared OSM node, radius = widest incident half-width.
    junctions = {}
    for r in records:
        half = r["width"] / 2
        for i, node in enumerate(r["nodes"]):
            if i < len(r["centerline"]) and node_use[node] > 1:
                x, z = r["centerline"][i]
                if node not in junctions or half > junctions[node][2]:
                    junctions[node] = (x, z, half)
    discs = [Point(x, z).buffer(half, quad_segs=QUAD) for x, z, half in junctions.values()]

    clip_zone = window.buffer(50)
    buffers = [r["line"].intersection(clip_zone).buffer(r["width"]/2, quad_segs=QUAD, cap_style="flat", join_style="round") for r in records]
    merged = union_all([g for g in buffers if not g.is_empty] + discs, grid_size=.01)
    if args.fillet > 0:
        merged = merged.buffer(args.fillet, quad_segs=QUAD).buffer(-args.fillet, quad_segs=QUAD)
    merged = merged.simplify(.05, preserve_topology=True)
    components = polygons(merged)

    lines = [r["line"] for r in records]; tree = STRtree(lines)
    args.output.mkdir(parents=True, exist_ok=True)
    for p in args.output.glob("*.json"): p.unlink()
    tiles = defaultdict(list)
    road_tiles = defaultdict(dict)
    emitted_ids = set()
    for component in components:
        component = component.intersection(window)
        for p in polygons(component):
            if p.area < .2: continue
            minx,minz,maxx,maxz = p.bounds
            for tx in range(math.floor(minx/TILE), math.floor(maxx/TILE)+1):
                for tz in range(math.floor(minz/TILE), math.floor(maxz/TILE)+1):
                    clipped = p.intersection(box(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE))
                    for q in polygons(clipped):
                        if q.area < .05: continue
                        # Densify AFTER clipping: both tiles share the same boundary
                        # endpoints, so they produce identical seam vertices.
                        q = segmentize(q, args.segment)
                        outer = local_ring(q.exterior.coords, tx, tz)
                        if outer is None: continue
                        holes = [h for h in (local_ring(r.coords, tx, tz) for r in q.interiors) if h]
                        candidates = list(tree.query(q, predicate="intersects"))
                        if not candidates:
                            candidates = [tree.nearest(q)]
                        ids = sorted({records[int(i)]["wayId"] for i in candidates})
                        emitted_ids.update(ids)
                        types = sorted({records[int(i)]["type"] for i in candidates})
                        widths_for_feature = [records[int(i)]["width"] for i in candidates]
                        tiles[f"{tx}_{tz}"].append({"ids":ids,"types":types,"width":max(widths_for_feature,default=0),
                            "outer":outer,"holes":holes})
    spawn_points = []
    for record in records:
        points = record["centerline"]
        if len(points) < 2:
            continue
        line = LineString(points)
        midpoint = line.interpolate(line.length / 2)
        segment = min(zip(points, points[1:]), key=lambda pair: LineString(pair).distance(midpoint))
        (ax, az), (bx, bz) = segment
        length = math.hypot(bx-ax, bz-az)
        if length > 0:
            spawn_points.append([round(midpoint.x, 3), round(midpoint.y, 3),
                                 round((bx-ax)/length, 6), round((bz-az)/length, 6)])
    for record in records:
        points, nodes = record["centerline"], record["nodes"]
        for seq, ((ax, az), (bx, bz)) in enumerate(zip(points, points[1:])):
            segment = LineString(((ax, az), (bx, bz)))
            segment_bounds = segment.buffer(record["width"]/2 + 2)
            for tx in range(math.floor((segment_bounds.bounds[0])/TILE), math.floor((segment_bounds.bounds[2])/TILE)+1):
                for tz in range(math.floor((segment_bounds.bounds[1])/TILE), math.floor((segment_bounds.bounds[3])/TILE)+1):
                    if not segment_bounds.intersects(box(tx*TILE,tz*TILE,(tx+1)*TILE,(tz+1)*TILE)):
                        continue
                    key=f"{tx}_{tz}"
                    if key not in tiles:
                        continue
                    edge={"wayId":record["wayId"],"type":record["type"],"width":record["width"],
                          "widthSource":record["widthSource"],"seq":seq,"a":[round(ax,3),round(az,3)],
                          "b":[round(bx,3),round(bz,3)],
                          "nodeA":nodes[seq] if seq < len(nodes) else None,
                          "nodeB":nodes[seq+1] if seq+1 < len(nodes) else None}
                    road_tiles[key][(record["wayId"],seq)]=edge
    for key,features in tiles.items():
        tx,tz=map(int,key.split("_"))
        payload={"version":1,"tx":tx,"tz":tz,"tileSize":TILE,"features":features,
                 "roads":list(road_tiles[key].values())}
        (args.output/f"{key}.json").write_text(json.dumps(payload,separators=(",",":")),encoding="utf8")
    clipped_away = sorted({r["wayId"] for r in records} - emitted_ids)
    excluded["no-positive-area-surface-after-clipping"] += len(clipped_away)
    excluded_ids["no-positive-area-surface-after-clipping"].extend(clipped_away)
    type_by_way = {r["wayId"]: r["type"] for r in records}
    emitted_class = Counter(type_by_way[wid] for wid in emitted_ids)
    manifest={"version":1,"build":"road-world-v4-polygon-subset","projection":{"center":CENTER,"units":"metres","x":"east","z":"south"},"center":{"lat":CENTER[0],"lon":CENTER[1]},"tileSize":TILE,"tiles":sorted(tiles),"spawnPoints":spawn_points,"sourceWays":len(source.get("elements",[])),"acceptedWays":len(emitted_ids),"excludedWays":len(source.get("elements",[]))-len(emitted_ids),"excludedByReason":dict(excluded),"excludedSourceWayIdsByReason":dict(excluded_ids),"acceptedWaysByClass":dict(emitted_class),"sourceWaysByClass":dict(source_by_class),"uniqueAcceptedWayIds":len(emitted_ids),"bounds":[round(window.bounds[0],2),round(window.bounds[1],2),round(window.bounds[2],2),round(window.bounds[3],2)],"unionComponents":len(components),"junctionDiscs":len(discs),"fillet":args.fillet,"segment":args.segment,"polygons":sum(len(v) for v in tiles.values()),"roadClassesWidthsMetres":DEFAULTS,"processingSeconds":round(time.perf_counter()-started,3),"scope":"representative visual gate only; no full-city release"}
    (args.output/"manifest.json").write_text(json.dumps(manifest,indent=2),encoding="utf8")
    print(json.dumps(manifest,indent=2))

if __name__ == "__main__": main()