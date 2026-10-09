const envC =
  buildEnvironmentPassC({

    scene,

    ways:
      osm.elements,

    project,

    ROAD_W,

    blocked,

    detailRadius:
      220

  });


console.log(
  'Environment Pass C:',
  envC
);