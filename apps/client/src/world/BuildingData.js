import { cleanRing, validHoles } from './BuildingRules.js';
export function selectRegion(index, x, z, preferred = null) {
    const matches = index.regions.filter(r => x >= r.worldBounds.minX && x <= r.worldBounds.maxX && z >= r.worldBounds.minZ && z <= r.worldBounds.maxZ);
    return matches.find(r => r.slug === preferred) ?? matches[0] ?? null;
}
export function validateManifest(m, region, projection) {
    if (m.version !== 1 || m.schemaVersion !== 2 || m.region !== region || m.tileSize !== 250 || m.quantization !== 0.1 || !Array.isArray(m.tiles) || !Array.isArray(m.categories) || !Array.isArray(m.roofs) || !Array.isArray(m.heightSources) || m.fields?.join(',') !== 'id,category,height,levels,minHeight,roof,seed,name,flags,heightSource,polygons,tags')
        throw new Error('Unsupported building manifest/schema');
    if (m.projection?.id !== projection.id || m.center?.lat !== projection.origin.lat || m.center?.lon !== projection.origin.lon)
        throw new Error('Building coordinate origin mismatch');
    if (m.projection.units !== 'metres' || m.projection.axes?.x !== 'east' || m.projection.axes?.z !== 'south' || m.categories.join(',') !== 'residential_low,residential_multi,commercial,mixed_use,office,school,university,hospital,clinic,hotel,industrial,warehouse,government,place_of_worship,market,parking_structure,generic' || m.roofs.join(',') !== 'flat,gable,hipped,pyramidal,shed,other' || m.heightSources.join(',') !== 'explicit_height,explicit_levels,inferred' || m.flags?.explicitCategory !== 1 || m.flags.explicitRoof !== 2 || m.flags.largeFootprint !== 4 || m.flags.heavyRoadOverlap !== 8 || !Array.isArray(m.tagKeys))
        throw new Error('Unsupported building tables/projection');
    if (m.tiles.some(k => !/^-?\d+_-?\d+$/.test(k)))
        throw new Error('Invalid building tile keys');
    return m;
}
export function decodeBuilding(row, tile, heightAt, manifest) {
    if (!Array.isArray(row) || row.length !== 12 || typeof row[0] !== 'string' || !/^(way|relation):\d+$/.test(row[0]) || !Number.isInteger(row[1]) || !manifest.categories[row[1]] || !Number.isFinite(row[2]) || row[2] <= 0 || row[2] > 300 || !Number.isFinite(row[3]) || row[3] <= 0 || !Number.isFinite(row[4]) || row[4] < 0 || row[4] >= row[2] || !Number.isInteger(row[5]) || !manifest.roofs[row[5]] || !Number.isInteger(row[6]) || row[6] < 0 || row[6] > 0xffffffff || !Number.isInteger(row[7]) || row[7] < 0 || row[7] >= tile.strings.length || !Number.isInteger(row[8]) || row[8] < 0 || row[8] > 15 || !Number.isInteger(row[9]) || !manifest.heightSources[row[9]] || !Array.isArray(row[10]) || !row[10].length || !Array.isArray(row[11]) || row[11].length % 2)
        return null;
    if (row[7] && typeof tile.strings[row[7]] !== 'string')
        return null;
    const tags = {};
    for (let i = 0; i < row[11].length; i += 2) {
        const k = row[11][i], v = row[11][i + 1];
        if (!Number.isInteger(k) || !manifest.tagKeys[k] || !Number.isInteger(v) || typeof tile.strings[v] !== 'string')
            return null;
        tags[manifest.tagKeys[k]] = tile.strings[v];
    }
    const polygons = row[10].map(p => Array.isArray(p) ? p.map(r => Array.isArray(r) && r.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isSafeInteger)) ? cleanRing(r.map(([x, z]) => [tile.tx * 250 + x * 0.1, tile.tz * 250 + z * 0.1])) : null) : []);
    if (polygons.some(p => !p.length || p.some(r => !r) || !validHoles(p)))
        return null;
    const points = polygons.flatMap(p => p[0]), ys = points.map(p => heightAt(...p));
    if (!ys.every(Number.isFinite))
        return null;
    const category = manifest.categories[row[1]], heightSource = manifest.heightSources[row[9]];
    return { id: row[0], category, height: row[2], levels: row[3], minHeight: row[4], roof: manifest.roofs[row[5]], seed: row[6], name: tile.strings[row[7]] ?? null, flags: row[8], heightSource, categorySource: row[8] & 1 ? 'explicit' : 'inferred', roofSource: row[8] & 2 ? 'explicit' : 'inferred', tags, polygons, baseY: Math.max(...ys), foundationBottom: Math.min(...ys), minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])) };
}
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const signedArea = ring => ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
function clippedArea(ring, rectangle) {
    let points = ring;
    for (let i = 0; i < 4 && points.length; i++) {
        const a = rectangle[i], b = rectangle[(i + 1) % 4], output = [];
        for (let j = 0; j < points.length; j++) {
            const p = points[j], q = points[(j + 1) % points.length], cp = cross(a, b, p), cq = cross(a, b, q);
            if (cp >= 0)
                output.push(p);
            if ((cp >= 0) !== (cq >= 0)) {
                const t = cp / (cp - cq);
                output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
            }
        }
        points = output;
    }
    return points.length >= 3 ? Math.abs(signedArea(points)) : 0;
}
export function roadRectangle(edge) {
    const dx = edge.b[0] - edge.a[0], dz = edge.b[1] - edge.a[1], length = Math.hypot(dx, dz);
    if (!length || !Number.isFinite(edge.width) || edge.width <= 0)
        return null;
    const nx = -dz / length * edge.width / 2, nz = dx / length * edge.width / 2;
    return [[edge.a[0] - nx, edge.a[1] - nz], [edge.b[0] - nx, edge.b[1] - nz],
        [edge.b[0] + nx, edge.b[1] + nz], [edge.a[0] + nx, edge.a[1] + nz]];
}
export function roadOverlapRatio(geometry, edges) {
    let area = 0;
    for (const edge of edges) {
        const rectangle = roadRectangle(edge);
        if (!rectangle)
            continue;
        for (const rings of geometry.polygons) {
            area += clippedArea(rings[0], rectangle);
            for (const hole of rings.slice(1))
                area -= clippedArea(hole, rectangle);
        }
    }
    return Math.max(0, Math.min(1, area / geometry.polygons.reduce((sum, rings) => sum + Math.abs(signedArea(rings[0])) - rings.slice(1).reduce((s, r) => s + Math.abs(signedArea(r)), 0), 0)));
}
