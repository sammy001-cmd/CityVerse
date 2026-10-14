// Keys are existing CityMap source identities, never new map/world IDs.
export const LANDMARK_MODELS = Object.freeze({
  'osm:way:1283222827': { modelOverrideId: 'cocoa-house-v1', tier: 'B', architecture: 'tower', regionId: 'ibadan' },
  'osm:way:82467201': { modelOverrideId: 'uch-v1', tier: 'C', architecture: 'institution', regionId: 'ibadan' },
  'osm:way:373337181': { modelOverrideId: 'agodi-gardens-v1', tier: 'B', architecture: 'park', regionId: 'ibadan' },
  'osm:way:1245094788': { modelOverrideId: 'lautech-senate-v1', tier: 'C', architecture: 'institution', regionId: 'ogbomoso' }
});
export function landmarkIdentity(record) {
  const model = LANDMARK_MODELS[record.id];
  return { ...record, regionId: record.region, worldCoordinates: { x: record.x, z: record.z },
    mapCoordinates: { x: record.x, z: record.z }, venueId: null, interactionId: null,
    verificationStatus: record.source?.provider === 'OpenStreetMap' ? 'source-derived' : 'curated',
    ...((model?.regionId === record.region) ? model : {}) };
}
