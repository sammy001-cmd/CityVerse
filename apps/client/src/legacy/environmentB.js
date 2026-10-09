import * as THREE from 'three';

// ============================================================
// CITYVERSE NG — ENVIRONMENT PASS B
//
// Adds:
// - Compound walls
// - Metal gates
// - Shop fronts
// - Shop awnings
// - Sign boards
// - AC units
// - Water tanks
// - Roadside kiosks
// - Potholes / road wear
//
// Everything repeated uses InstancedMesh.
// ============================================================


// ------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------

function makeInstances(
  scene,
  geometry,
  material,
  matrices,
  {
    castShadow = false,
    receiveShadow = false
  } = {}
) {

  if (!matrices.length) return null;

  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    matrices.length
  );

  matrices.forEach((matrix, index) => {
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;

  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;

  scene.add(mesh);

  return mesh;
}


function matrixAt(
  x,
  y,
  z,
  yaw = 0,
  sx = 1,
  sy = 1,
  sz = 1
) {

  const obj = new THREE.Object3D();

  obj.position.set(x, y, z);

  obj.rotation.y = yaw;

  obj.scale.set(
    sx,
    sy,
    sz
  );

  obj.updateMatrix();

  return obj.matrix.clone();
}


// deterministic number
function hash(x, z, salt = 0) {

  const value =
    Math.sin(
      x * 12.9898 +
      z * 78.233 +
      salt * 37.719
    ) *
    43758.5453;

  return value - Math.floor(value);
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


// ------------------------------------------------------------
// Distance from point to road segment
// ------------------------------------------------------------

function pointSegmentDistance(
  px,
  pz,
  ax,
  az,
  bx,
  bz
) {

  const vx = bx - ax;
  const vz = bz - az;

  const wx = px - ax;
  const wz = pz - az;

  const lenSq =
    vx * vx +
    vz * vz;

  let t =
    lenSq > 0
      ? (
          wx * vx +
          wz * vz
        ) / lenSq
      : 0;

  t = THREE.MathUtils.clamp(
    t,
    0,
    1
  );


  const x =
    ax +
    vx * t;

  const z =
    az +
    vz * t;


  return {
    distance:
      Math.hypot(
        px - x,
        pz - z
      ),

    x,
    z
  };

}


// ============================================================
// MAIN FUNCTION
// ============================================================

export function buildEnvironmentPassB({

  scene,
  ways,
  project,
  ROAD_W,
  blocked = () => false,

  detailRadius = 240

}) {

  // ==========================================================
  // INSTANCE ARRAYS
  // ==========================================================

  const compoundWalls = [];
  const gates = [];

  const shopFronts = [];
  const awnings = [];
  const signs = [];

  const airConditioners = [];

  const tanks = [];
  const tankStands = [];

  const kioskBodies = [];
  const kioskRoofs = [];

  const potholes = [];


  // ==========================================================
  // PREPARE ROAD SEGMENTS
  // ==========================================================

  const roadSegments = [];


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


    const pts =
      way.geometry.map(
        (p) =>
          project(
            p.lat,
            p.lon
          )
      );


    for (
      let i = 1;
      i < pts.length;
      i++
    ) {

      const a =
        pts[i - 1];

      const b =
        pts[i];


      roadSegments.push({

        ax: a[0],
        az: a[1],

        bx: b[0],
        bz: b[1],

        width,
        type

      });

    }

  }


  // ==========================================================
  // BUILDINGS
  // ==========================================================

  for (const way of ways) {

    if (
      !way.tags?.building ||
      !way.geometry ||
      way.geometry.length < 4
    ) {

      continue;

    }


    const pts =
      way.geometry.map(
        (p) =>
          project(
            p.lat,
            p.lon
          )
      );


    const first =
      pts[0];

    const last =
      pts[
        pts.length - 1
      ];


    if (
      first[0] === last[0] &&
      first[1] === last[1]
    ) {

      pts.pop();

    }


    if (
      pts.length < 3
    ) {

      continue;

    }


    // --------------------------------------------------------
    // Building centre
    // --------------------------------------------------------

    const cx =
      pts.reduce(
        (sum, p) =>
          sum + p[0],
        0
      ) /
      pts.length;


    const cz =
      pts.reduce(
        (sum, p) =>
          sum + p[1],
        0
      ) /
      pts.length;


    if (
      Math.hypot(
        cx,
        cz
      ) >
      detailRadius
    ) {

      continue;

    }


    // ========================================================
    // FIND WALL CLOSEST TO A ROAD
    // ========================================================

    let frontIndex = 0;
    let bestRoadDistance = Infinity;


    for (
      let i = 0;
      i < pts.length;
      i++
    ) {

      const a =
        pts[i];

      const b =
        pts[
          (i + 1) %
          pts.length
        ];


      const mx =
        (
          a[0] +
          b[0]
        ) /
        2;


      const mz =
        (
          a[1] +
          b[1]
        ) /
        2;


      for (
        const road
        of roadSegments
      ) {

        const result =
          pointSegmentDistance(

            mx,
            mz,

            road.ax,
            road.az,

            road.bx,
            road.bz

          );


        if (
          result.distance <
          bestRoadDistance
        ) {

          bestRoadDistance =
            result.distance;

          frontIndex =
            i;

        }

      }

    }


    const frontA =
      pts[frontIndex];


    const frontB =
      pts[
        (frontIndex + 1) %
        pts.length
      ];


    const dx =
      frontB[0] -
      frontA[0];


    const dz =
      frontB[1] -
      frontA[1];


    const frontLength =
      Math.hypot(
        dx,
        dz
      );


    if (
      frontLength <
      3
    ) {

      continue;

    }


    const ux =
      dx /
      frontLength;


    const uz =
      dz /
      frontLength;


    let nx =
      -uz;

    let nz =
      ux;


    const mx =
      (
        frontA[0] +
        frontB[0]
      ) /
      2;


    const mz =
      (
        frontA[1] +
        frontB[1]
      ) /
      2;


    // ensure normal points outside building
    if (

      (
        mx -
        cx
      ) *
      nx +

      (
        mz -
        cz
      ) *
      nz

      < 0

    ) {

      nx *= -1;
      nz *= -1;

    }


    const yaw =
      -Math.atan2(
        uz,
        ux
      );


    const rand =
      hash(
        cx,
        cz
      );


    // ========================================================
    // DETERMINE BUILDING TYPE
    // ========================================================

    const tags =
      way.tags || {};


    const commercial =
      !!tags.shop ||
      !!tags.amenity ||
      [
        'commercial',
        'retail',
        'office'
      ].includes(
        tags.building
      ) ||
      rand < 0.18;


    // ========================================================
    // COMMERCIAL BUILDINGS
    // ========================================================

    if (
      commercial &&
      frontLength > 4
    ) {

      // Shop front panel
      shopFronts.push(

        matrixAt(
          mx +
            nx * 0.07,

          1.25,

          mz +
            nz * 0.07,

          yaw,

          Math.min(
            frontLength *
              0.55,
            4
          ),

          1,

          1
        )

      );


      // Awning
      awnings.push(

        matrixAt(
          mx +
            nx * 0.55,

          2.45,

          mz +
            nz * 0.55,

          yaw,

          Math.min(
            frontLength *
              0.58,
            4.3
          ),

          1,

          1
        )

      );


      // Sign
      signs.push(

        matrixAt(
          mx +
            nx * 0.1,

          3.15,

          mz +
            nz * 0.1,

          yaw,

          Math.min(
            frontLength *
              0.45,
            3.2
          ),

          1,

          1
        )

      );

    }


    // ========================================================
    // RESIDENTIAL BUILDINGS
    // ========================================================

    else {

      // only compounds with some space between
      // building and road
      if (
        bestRoadDistance >
          5 &&
        bestRoadDistance <
          15 &&
        frontLength >
          6
      ) {

        const compoundDistance =
          Math.min(
            2.4,
            bestRoadDistance *
              0.35
          );


        const wallX =
          mx +
          nx *
          compoundDistance;


        const wallZ =
          mz +
          nz *
          compoundDistance;


        const gateWidth =
          2.8;


        const sideLength =
          (
            frontLength -
            gateWidth
          ) /
          2;


        if (
          sideLength >
          1
        ) {

          // LEFT WALL
          compoundWalls.push(

            matrixAt(

              wallX -
                ux *
                (
                  gateWidth /
                    2 +
                  sideLength /
                    2
                ),

              0.7,

              wallZ -
                uz *
                (
                  gateWidth /
                    2 +
                  sideLength /
                    2
                ),

              yaw,

              sideLength,

              1,

              1

            )

          );


          // RIGHT WALL
          compoundWalls.push(

            matrixAt(

              wallX +
                ux *
                (
                  gateWidth /
                    2 +
                  sideLength /
                    2
                ),

              0.7,

              wallZ +
                uz *
                (
                  gateWidth /
                    2 +
                  sideLength /
                    2
                ),

              yaw,

              sideLength,

              1,

              1

            )

          );


          // gate
          gates.push(

            matrixAt(

              wallX,

              0.9,

              wallZ,

              yaw,

              gateWidth,

              1,

              1

            )

          );

        }

      }

    }


    // ========================================================
    // AIR CONDITIONER
    // ========================================================

    if (
      rand > 0.45
    ) {

      const acT =
        0.72;


      const acX =
        frontA[0] +
        dx *
        acT +
        nx *
        0.18;


      const acZ =
        frontA[1] +
        dz *
        acT +
        nz *
        0.18;


      airConditioners.push(

        matrixAt(

          acX,

          2.45,

          acZ,

          yaw

        )

      );

    }


    // ========================================================
    // WATER TANK
    // ========================================================

    if (
      rand > 0.68
    ) {

      const tx =
        cx -
        nx *
        3;


      const tz =
        cz -
        nz *
        3;


      if (
        !blocked(
          tx,
          tz
        )
      ) {

        tankStands.push(

          matrixAt(
            tx,
            1.7,
            tz
          )

        );


        tanks.push(

          matrixAt(
            tx,
            3.65,
            tz
          )

        );

      }

    }

  }


  // ==========================================================
  // ROADSIDE KIOSKS + POTHOLES
  // ==========================================================

  for (
    const road
    of roadSegments
  ) {

    const dx =
      road.bx -
      road.ax;


    const dz =
      road.bz -
      road.az;


    const length =
      Math.hypot(
        dx,
        dz
      );


    if (
      length <
      10
    ) {

      continue;

    }


    const ux =
      dx /
      length;


    const uz =
      dz /
      length;


    const nx =
      -uz;


    const nz =
      ux;


    // --------------------------------------------------------
    // POTHOLES
    // --------------------------------------------------------

    const roadSeed =
      hash(
        road.ax,
        road.az,
        7
      );


    const potholeChance =
      [
        'residential',
        'unclassified',
        'living_street'
      ].includes(
        road.type
      )
        ? 0.25
        : 0.06;


    if (
      roadSeed <
      potholeChance
    ) {

      const t =
        0.25 +
        hash(
          road.bx,
          road.bz,
          2
        ) *
          0.5;


      const px =
        road.ax +
        dx * t;


      const pz =
        road.az +
        dz * t;


      const offset =
        (
          hash(
            road.ax,
            road.bz,
            5
          ) -
          0.5
        ) *
        road.width *
        0.45;


      potholes.push(

        matrixAt(

          px +
            nx *
            offset,

          0.061,

          pz +
            nz *
            offset,

          0,

          0.5 +
            roadSeed *
            0.8,

          1,

          0.4 +
            roadSeed *
            0.7

        )

      );

    }


    // --------------------------------------------------------
    // KIOSKS
    // --------------------------------------------------------

    const kioskChance =
      hash(
        road.ax,
        road.az,
        19
      );


    if (
      kioskChance >
        0.88 &&
      road.width >= 5
    ) {

      const t =
        0.35 +
        hash(
          road.bx,
          road.bz,
          11
        ) *
        0.3;


      const side =
        hash(
          road.ax,
          road.bz,
          13
        ) >
        0.5
          ? 1
          : -1;


      const offset =
        road.width /
          2 +
        4;


      const x =
        road.ax +
        dx *
        t +
        nx *
        offset *
        side;


      const z =
        road.az +
        dz *
        t +
        nz *
        offset *
        side;


      if (
        !blocked(
          x,
          z
        )
      ) {

        const yaw =
          Math.atan2(
            ux,
            uz
          );


        kioskBodies.push(

          matrixAt(
            x,
            1,
            z,
            yaw
          )

        );


        kioskRoofs.push(

          matrixAt(
            x,
            2.15,
            z,
            yaw
          )

        );

      }

    }

  }


  // ==========================================================
  // GEOMETRY + MATERIALS
  // ==========================================================


  // ----------------------------------------------------------
  // COMPOUND WALL
  // ----------------------------------------------------------

  const wallGeometry =
    new THREE.BoxGeometry(
      1,
      1.4,
      0.18
    );


  const wallMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0xb7aa94,

      roughness:
        0.95

    });


  makeInstances(

    scene,

    wallGeometry,

    wallMaterial,

    compoundWalls,

    {
      castShadow:
        true,

      receiveShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // METAL GATES
  // ----------------------------------------------------------

  const gateGeometry =
    new THREE.BoxGeometry(
      1,
      1.8,
      0.12
    );


  const gateMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x45413d,

      roughness:
        0.65,

      metalness:
        0.35

    });


  makeInstances(

    scene,

    gateGeometry,

    gateMaterial,

    gates,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // SHOP FRONTS
  // ----------------------------------------------------------

  const shopGeometry =
    new THREE.PlaneGeometry(
      1,
      2.3
    );


  const shopMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x385d6d,

      roughness:
        0.5,

      side:
        THREE.DoubleSide

    });


  makeInstances(

    scene,

    shopGeometry,

    shopMaterial,

    shopFronts

  );


  // ----------------------------------------------------------
  // AWNINGS
  // ----------------------------------------------------------

  const awningGeometry =
    new THREE.BoxGeometry(
      1,
      0.12,
      1.05
    );


  const awningMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x31557a,

      roughness:
        0.7

    });


  makeInstances(

    scene,

    awningGeometry,

    awningMaterial,

    awnings,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // SHOP SIGNS
  // ----------------------------------------------------------

  const signGeometry =
    new THREE.BoxGeometry(
      1,
      0.65,
      0.06
    );


  const signMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0xe6c451,

      roughness:
        0.6

    });


  makeInstances(

    scene,

    signGeometry,

    signMaterial,

    signs

  );


  // ----------------------------------------------------------
  // AIR CONDITIONERS
  // ----------------------------------------------------------

  const acGeometry =
    new THREE.BoxGeometry(
      0.75,
      0.55,
      0.3
    );


  const acMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0xd8d7d2,

      roughness:
        0.8

    });


  makeInstances(

    scene,

    acGeometry,

    acMaterial,

    airConditioners,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // WATER TANKS
  // ----------------------------------------------------------

  const tankGeometry =
    new THREE.CylinderGeometry(

      0.55,
      0.55,
      1.15,
      12

    );


  const tankMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x14191d,

      roughness:
        0.78

    });


  makeInstances(

    scene,

    tankGeometry,

    tankMaterial,

    tanks,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // TANK STANDS
  // ----------------------------------------------------------

  const standGeometry =
    new THREE.BoxGeometry(
      0.85,
      3.4,
      0.85
    );


  const standMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x595653,

      roughness:
        0.8,

      wireframe:
        true

    });


  makeInstances(

    scene,

    standGeometry,

    standMaterial,

    tankStands

  );


  // ----------------------------------------------------------
  // KIOSK BODY
  // ----------------------------------------------------------

  const kioskGeometry =
    new THREE.BoxGeometry(
      2,
      2,
      1.5
    );


  const kioskMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x86735d,

      roughness:
        0.9

    });


  makeInstances(

    scene,

    kioskGeometry,

    kioskMaterial,

    kioskBodies,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // KIOSK ROOF
  // ----------------------------------------------------------

  const kioskRoofGeometry =
    new THREE.BoxGeometry(
      2.5,
      0.12,
      2
    );


  const kioskRoofMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x82462e,

      metalness:
        0.15,

      roughness:
        0.75

    });


  makeInstances(

    scene,

    kioskRoofGeometry,

    kioskRoofMaterial,

    kioskRoofs,

    {
      castShadow:
        true
    }

  );


  // ----------------------------------------------------------
  // POTHOLES
  // ----------------------------------------------------------

  const potholeGeometry =
    new THREE.CircleGeometry(
      1,
      12
    );


  potholeGeometry.rotateX(
    -Math.PI /
    2
  );


  const potholeMaterial =
    new THREE.MeshStandardMaterial({

      color:
        0x161719,

      roughness:
        1,

      polygonOffset:
        true,

      polygonOffsetFactor:
        -1,

      polygonOffsetUnits:
        -1

    });


  makeInstances(

    scene,

    potholeGeometry,

    potholeMaterial,

    potholes

  );


  // ==========================================================
  // RETURN STATS
  // ==========================================================

  return {

    compoundWalls:
      compoundWalls.length,

    gates:
      gates.length,

    shops:
      shopFronts.length,

    awnings:
      awnings.length,

    signs:
      signs.length,

    airConditioners:
      airConditioners.length,

    tanks:
      tanks.length,

    kiosks:
      kioskBodies.length,

    potholes:
      potholes.length

  };

}