import * as THREE from 'three';

// ============================================================
// CITYVERSE NG — ENVIRONMENT PASS A
// Adds:
// - Road markings
// - Roadside drainage
// - Windows
// - Doors
//
// Uses InstancedMesh for performance.
// ============================================================


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function pushMatrix(list, position, yaw = 0) {

  const obj = new THREE.Object3D();

  obj.position.set(
    position[0],
    position[1],
    position[2]
  );

  obj.rotation.y = yaw;

  obj.updateMatrix();

  list.push(obj.matrix.clone());
}


function makeInstances(
  scene,
  geometry,
  material,
  matrices,
  options = {}
) {

  if (!matrices.length) {
    return null;
  }

  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    matrices.length
  );

  matrices.forEach((matrix, index) => {

    mesh.setMatrixAt(
      index,
      matrix
    );

  });

  mesh.instanceMatrix.needsUpdate = true;

  mesh.castShadow =
    options.castShadow || false;

  mesh.receiveShadow =
    options.receiveShadow || false;

  scene.add(mesh);

  return mesh;
}


function polygonArea(points) {

  let area = 0;

  for (
    let i = 0, j = points.length - 1;
    i < points.length;
    j = i++
  ) {

    area +=
      points[j][0] * points[i][1] -
      points[i][0] * points[j][1];

  }

  return area / 2;
}


function segmentSamples(
  a,
  b,
  spacing,
  start = spacing * 0.5
) {

  const dx = b[0] - a[0];
  const dz = b[1] - a[1];

  const length = Math.hypot(
    dx,
    dz
  );

  if (length < 0.001) {
    return [];
  }

  const ux = dx / length;
  const uz = dz / length;

  const samples = [];

  for (
    let distance = start;
    distance < length;
    distance += spacing
  ) {

    samples.push({

      x:
        a[0] +
        ux * distance,

      z:
        a[1] +
        uz * distance,

      ux,
      uz

    });

  }

  return samples;
}


// ============================================================
// MAIN ENVIRONMENT FUNCTION
// ============================================================

export function buildEnvironmentPassA({

  scene,
  ways,
  project,
  ROAD_W,
  blocked = () => false,

  // Don't decorate the whole district heavily yet.
  // Keep detailed facades close to centre for FPS.
  detailRadius = 260

}) {

  const roadDashMatrices = [];

  const drainMatrices = [];

  const drainLeftMatrices = [];

  const drainRightMatrices = [];

  const windowMatrices = [];

  const doorMatrices = [];


  // ==========================================================
  // ROADS
  // ==========================================================

  for (const way of ways) {

    const type =
      way.tags?.highway;

    const width =
      ROAD_W[type];

    if (
      !width ||
      !way.geometry ||
      way.geometry.length < 2
    ) {

      continue;

    }

    const points =
      way.geometry.map((point) =>
        project(
          point.lat,
          point.lon
        )
      );


    // --------------------------------------------------------
    // Each road segment
    // --------------------------------------------------------

    for (
      let i = 1;
      i < points.length;
      i++
    ) {

      const a =
        points[i - 1];

      const b =
        points[i];

      const dx =
        b[0] - a[0];

      const dz =
        b[1] - a[1];

      const length =
        Math.hypot(
          dx,
          dz
        );

      if (length < 1) {
        continue;
      }


      const ux =
        dx / length;

      const uz =
        dz / length;


      // Perpendicular direction
      const nx =
        -uz;

      const nz =
        ux;


      // ======================================================
      // ROAD CENTRE MARKINGS
      // ======================================================

      const markedRoad =
        [
          'motorway',
          'trunk',
          'primary',
          'secondary',
          'tertiary'
        ].includes(type);


      if (markedRoad) {

        const samples =
          segmentSamples(
            a,
            b,
            9,
            2.5
          );


        for (const sample of samples) {

          const yaw =
            Math.atan2(
              sample.ux,
              sample.uz
            );


          pushMatrix(

            roadDashMatrices,

            [
              sample.x,
              0.075,
              sample.z
            ],

            yaw

          );

        }

      }


      // ======================================================
      // OPEN ROADSIDE DRAINAGE
      // ======================================================

      if (width >= 5) {

        const samples =
          segmentSamples(
            a,
            b,
            4.2,
            1.8
          );


        for (const sample of samples) {

          const yaw =
            Math.atan2(
              sample.ux,
              sample.uz
            );


          const offset =
            width / 2 + 0.7;


          // Both sides of road
          for (const side of [-1, 1]) {

            const x =
              sample.x +
              nx *
              offset *
              side;


            const z =
              sample.z +
              nz *
              offset *
              side;


            // Don't create drainage inside buildings
            if (
              blocked(
                x,
                z
              )
            ) {

              continue;

            }


            // Main dark drainage channel
            pushMatrix(

              drainMatrices,

              [
                x,
                0.025,
                z
              ],

              yaw

            );


            // Concrete sides
            const lipGap =
              0.38;


            pushMatrix(

              drainLeftMatrices,

              [
                x +
                nx *
                lipGap,

                0.08,

                z +
                nz *
                lipGap
              ],

              yaw

            );


            pushMatrix(

              drainRightMatrices,

              [
                x -
                nx *
                lipGap,

                0.08,

                z -
                nz *
                lipGap
              ],

              yaw

            );

          }

        }

      }

    }

  }


  // ==========================================================
  // BUILDING FACADES
  // ==========================================================

  for (const way of ways) {

    if (
      !way.tags?.building ||
      !way.geometry ||
      way.geometry.length < 4
    ) {

      continue;

    }


    const points =
      way.geometry.map((point) =>
        project(
          point.lat,
          point.lon
        )
      );


    const first =
      points[0];

    const last =
      points[
        points.length - 1
      ];


    // Remove duplicate last point
    if (
      first[0] === last[0] &&
      first[1] === last[1]
    ) {

      points.pop();

    }


    if (
      points.length < 3
    ) {

      continue;

    }


    // --------------------------------------------------------
    // Building centre
    // --------------------------------------------------------

    const centerX =
      points.reduce(
        (sum, point) =>
          sum + point[0],
        0
      ) /
      points.length;


    const centerZ =
      points.reduce(
        (sum, point) =>
          sum + point[1],
        0
      ) /
      points.length;


    // Keep facade details close enough
    // until proper tile streaming exists.
    if (
      Math.hypot(
        centerX,
        centerZ
      ) >
      detailRadius
    ) {

      continue;

    }


    // --------------------------------------------------------
    // Floors
    // --------------------------------------------------------

    let levels =
      parseFloat(
        way.tags[
          'building:levels'
        ]
      );


    if (!levels) {
      levels = 1;
    }


    levels =
      Math.max(
        1,
        Math.min(
          3,
          Math.round(levels)
        )
      );


    // --------------------------------------------------------
    // Find longest edge.
    // We'll temporarily treat it as building front.
    // --------------------------------------------------------

    let frontIndex = 0;

    let frontLength = -1;


    for (
      let i = 0;
      i < points.length;
      i++
    ) {

      const a =
        points[i];

      const b =
        points[
          (i + 1) %
          points.length
        ];


      const length =
        Math.hypot(

          b[0] - a[0],

          b[1] - a[1]

        );


      if (
        length >
        frontLength
      ) {

        frontLength =
          length;

        frontIndex =
          i;

      }

    }


    const winding =
      Math.sign(
        polygonArea(points)
      ) || 1;


    // ========================================================
    // EACH BUILDING WALL
    // ========================================================

    for (
      let i = 0;
      i < points.length;
      i++
    ) {

      const a =
        points[i];


      const b =
        points[
          (i + 1) %
          points.length
        ];


      const dx =
        b[0] - a[0];


      const dz =
        b[1] - a[1];


      const length =
        Math.hypot(
          dx,
          dz
        );


      if (
        length < 2.8
      ) {

        continue;

      }


      const ux =
        dx / length;


      const uz =
        dz / length;


      // Initial wall normal
      let nx =
        -uz *
        winding;


      let nz =
        ux *
        winding;


      const middleX =
        (
          a[0] +
          b[0]
        ) /
        2;


      const middleZ =
        (
          a[1] +
          b[1]
        ) /
        2;


      // Make sure normal points outside building
      if (

        (
          middleX -
          centerX
        ) *
        nx +

        (
          middleZ -
          centerZ
        ) *
        nz

        < 0

      ) {

        nx *= -1;

        nz *= -1;

      }


      // Rotate facade card to wall
      const yaw =
        -Math.atan2(
          uz,
          ux
        );


      // ------------------------------------------------------
      // WINDOWS
      // ------------------------------------------------------

      const windowSpacing =
        2.8;


      const windowCount =
        Math.max(

          1,

          Math.floor(
            (
              length -
              1.2
            ) /
            windowSpacing
          )

        );


      for (
        let floor = 0;
        floor < levels;
        floor++
      ) {

        const y =
          1.55 +
          floor * 3.05;


        for (
          let windowIndex = 0;
          windowIndex < windowCount;
          windowIndex++
        ) {

          const t =
            (
              windowIndex +
              1
            ) /
            (
              windowCount +
              1
            );


          // Leave room for door
          if (

            i ===
              frontIndex &&

            floor === 0 &&

            Math.abs(
              t -
              0.5
            ) <
              0.18

          ) {

            continue;

          }


          const x =
            a[0] +
            dx *
            t +
            nx *
            0.045;


          const z =
            a[1] +
            dz *
            t +
            nz *
            0.045;


          pushMatrix(

            windowMatrices,

            [
              x,
              y,
              z
            ],

            yaw

          );

        }

      }


      // ------------------------------------------------------
      // FRONT DOOR
      // ------------------------------------------------------

      if (

        i ===
          frontIndex &&

        length >=
          3.2

      ) {

        const x =
          middleX +
          nx *
          0.055;


        const z =
          middleZ +
          nz *
          0.055;


        pushMatrix(

          doorMatrices,

          [
            x,
            1.05,
            z
          ],

          yaw

        );

      }

    }

  }


  // ==========================================================
  // MATERIALS + INSTANCED OBJECTS
  // ==========================================================


  // ----------------------------------------------------------
  // Road centre markings
  // ----------------------------------------------------------

  const dashGeometry =
    new THREE.BoxGeometry(
      0.15,
      0.025,
      3.2
    );


  const dashMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0xf2e8c9,

      roughness:
        0.85

    });


  makeInstances(

    scene,

    dashGeometry,

    dashMaterial,

    roadDashMatrices,

    {
      receiveShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // Drainage
  // ----------------------------------------------------------

  const drainGeometry =
    new THREE.BoxGeometry(
      0.62,
      0.035,
      4
    );


  const drainMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x292a27,

      roughness:
        1

    });


  makeInstances(

    scene,

    drainGeometry,

    drainMaterial,

    drainMatrices,

    {
      receiveShadow:
        true
    }

  );


  // Concrete drainage lips
  const drainLipGeometry =
    new THREE.BoxGeometry(
      0.14,
      0.14,
      4
    );


  const drainLipMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x8d8376,

      roughness:
        0.95

    });


  makeInstances(

    scene,

    drainLipGeometry,

    drainLipMaterial,

    drainLeftMatrices,

    {
      receiveShadow:
        true
    }

  );


  makeInstances(

    scene,

    drainLipGeometry,

    drainLipMaterial,

    drainRightMatrices,

    {
      receiveShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // WINDOWS
  // ----------------------------------------------------------

  const windowGeometry =
    new THREE.PlaneGeometry(
      1.1,
      0.95
    );


  const windowMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x213944,

      roughness:
        0.35,

      metalness:
        0.05,

      side:
        THREE.DoubleSide

    });


  makeInstances(

    scene,

    windowGeometry,

    windowMaterial,

    windowMatrices

  );


  // ----------------------------------------------------------
  // DOORS
  // ----------------------------------------------------------

  const doorGeometry =
    new THREE.PlaneGeometry(
      1.05,
      2.05
    );


  const doorMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x4e3629,

      roughness:
        0.82,

      side:
        THREE.DoubleSide

    });


  makeInstances(

    scene,

    doorGeometry,

    doorMaterial,

    doorMatrices

  );


  // ==========================================================
  // RETURN STATS
  // ==========================================================

  return {

    roadDashes:
      roadDashMatrices.length,

    drainSegments:
      drainMatrices.length,

    windows:
      windowMatrices.length,

    doors:
      doorMatrices.length

  };

}