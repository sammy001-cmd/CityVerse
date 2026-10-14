// Pure selection contract for a future client. No fetching, rendering or physics.
export function selectWorldRegion(index,x,z,preferredSlug=null) {
  if(!Number.isFinite(x)||!Number.isFinite(z))return null;
  const contains=region=>x>=region.worldBounds.minX&&x<=region.worldBounds.maxX
    &&z>=region.worldBounds.minZ&&z<=region.worldBounds.maxZ;
  return index.regions.find(r=>r.slug===preferredSlug&&contains(r))
    ?? index.regions.find(contains) ?? null;
}
export function buildingManifestForPosition(index,x,z,preferredSlug=null) {
  const region=selectWorldRegion(index,x,z,preferredSlug);
  return region?.layers.buildings?.available ? region.layers.buildings.manifest : null;
}
