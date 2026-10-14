// Visual/gameplay defaults, not a claim about surveyed Nigerian road widths.
// Explicit source widths/lanes win. Sidewalk construction requires an opt-in.
export const ROAD_CLASSES = Object.freeze({
  motorway: { laneWidth:3.5, lanes:4, shoulder:2, blend:3, center:'solid', edge:true, urban:false },
  trunk: { laneWidth:3.5, lanes:2, shoulder:1.8, blend:3, center:'broken', edge:true, urban:false },
  primary: { laneWidth:3.3, lanes:2, shoulder:1, blend:2, center:'broken', edge:true, urban:true },
  secondary: { laneWidth:3.2, lanes:2, shoulder:0.8, blend:2, center:'broken', edge:true, urban:true },
  tertiary: { laneWidth:3, lanes:2, shoulder:0.7, blend:1.5, center:'broken', edge:false, urban:true },
  residential: { laneWidth:2.75, lanes:2, shoulder:0.7, blend:1.2, center:null, edge:false, urban:true },
  unclassified: { laneWidth:2.75, lanes:2, shoulder:0.8, blend:1.5, center:null, edge:false, urban:false },
  service: { laneWidth:2.5, lanes:1, shoulder:0.4, blend:1, center:null, edge:false, urban:false },
  living_street: { laneWidth:2.5, lanes:1, shoulder:0.3, blend:1, center:null, edge:false, urban:true }
});

export function roadClass(road) {
  const type = (road.type ?? 'unclassified').replace(/_link$/, '');
  const defaults = ROAD_CLASSES[type] ?? ROAD_CLASSES.unclassified;
  const lanes = Number.isFinite(Number(road.lanes)) && Number(road.lanes)>0 ? Math.min(6,Number(road.lanes)) : defaults.lanes;
  const width = Number.isFinite(road.width) && road.width>0 ? road.width : defaults.laneWidth*lanes;
  const sidewalks = defaults.urban && (road.sidewalk === true || ['both','left','right','yes'].includes(road.sidewalk));
  return { ...defaults, type, lanes, width, sidewalk:sidewalks,
    sidewalkWidth:sidewalks ? Math.max(0.8, Math.min(2.5,road.sidewalkWidth ?? 1.4)) : 0,
    curbHeight:sidewalks ? 0.12 : 0,
    center:width>=5.5 && !road.oneway ? defaults.center : null,
    // Access/link roads need no imaginary opposing traffic center line.
    edge:defaults.edge && width>=5.5,
    asphaltColor:['motorway','trunk','primary'].includes(type) ? '#34383d' :
      ['secondary','tertiary'].includes(type) ? '#424448' : '#53504c' };
}
