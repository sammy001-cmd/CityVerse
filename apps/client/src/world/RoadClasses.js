// Visual/gameplay defaults, not a claim about surveyed Nigerian road widths.
// Explicit source widths/lanes win. Sidewalk construction requires an opt-in.
export const ROAD_CLASSES = Object.freeze({
  motorway: { laneWidth:3.5, lanes:4, shoulder:1.8, blend:2.4, center:'solid', edge:true, urban:false, tone:'#34383d' },
  trunk: { laneWidth:3.4, lanes:2, shoulder:1.3, blend:2, center:'broken', edge:true, urban:false, tone:'#3b3d40' },
  primary: { laneWidth:3.25, lanes:2, shoulder:0.65, blend:1.5, center:'broken', edge:true, urban:true, tone:'#414244' },
  secondary: { laneWidth:3, lanes:2, shoulder:0.45, blend:1.2, center:'broken', edge:true, urban:true, tone:'#474746' },
  tertiary: { laneWidth:2.8, lanes:2, shoulder:0.3, blend:0.95, center:'broken', edge:false, urban:true, tone:'#4b4946' },
  residential: { laneWidth:2.6, lanes:2, shoulder:0.22, blend:0.8, center:null, edge:false, urban:true, tone:'#504d48' },
  unclassified: { laneWidth:2.6, lanes:2, shoulder:0.25, blend:0.9, center:null, edge:false, urban:false, tone:'#514e49' },
  service: { laneWidth:2.4, lanes:1, shoulder:0.18, blend:0.65, center:null, edge:false, urban:false, tone:'#55514b' },
  living_street: { laneWidth:2.5, lanes:1, shoulder:0.2, blend:0.7, center:null, edge:false, urban:true, tone:'#514e49' }
});

export function roadClass(road) {
  const type = (road.type ?? 'unclassified').replace(/_link$/, '');
  const defaults = ROAD_CLASSES[type] ?? ROAD_CLASSES.unclassified;
  const sourceLanes=Number.parseInt(road.lanes,10);
  const lanes=Number.isFinite(sourceLanes)&&sourceLanes>0?Math.min(6,sourceLanes):defaults.lanes;
  const sourceWidth=Number(road.width);
  // Reject implausible legacy/generated widths; the OSM width tag is preserved
  // separately so only an explicit, plausible source measurement wins.
  const hasMeasuredWidth=road.widthSource==='osm'&&Number.isFinite(sourceWidth)&&sourceWidth>=2.2&&sourceWidth<=32;
  const width=hasMeasuredWidth?sourceWidth:defaults.laneWidth*lanes;
  const oneWay=road.oneway===true||road.oneWay===true||['yes','true','1'].includes(String(road.oneway??road.oneWay??'').toLowerCase());
  const sidewalks = defaults.urban && (road.sidewalk === true || ['both','left','right','yes'].includes(road.sidewalk));
  return { ...defaults, type, lanes, width, sidewalk:sidewalks,
    sidewalkWidth:sidewalks ? Math.max(0.8, Math.min(2.5,road.sidewalkWidth ?? 1.4)) : 0,
    curbHeight:sidewalks ? 0.12 : 0,
    center:width>=5.1 && !oneWay && lanes>=2 ? defaults.center : null,
    // Access/link roads need no imaginary opposing traffic center line.
    edge:defaults.edge && width>=5.5,
    asphaltColor:defaults.tone };
}
