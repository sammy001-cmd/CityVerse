import * as THREE from 'three';

// ============================================================
// CITYVERSE NG — REAL TERRAIN
// AWS / Mapzen Terrarium elevation tiles
//
// Terrarium:
// elevation = (R * 256 + G + B / 256) - 32768
// ============================================================

const TILE_SIZE = 256;

const M_LON = 111320;
const M_LAT = 110540;


// ------------------------------------------------------------
// LAT/LON → WEB MERCATOR TILE
// ------------------------------------------------------------

function lonToTileX(lon, zoom) {

  const n = 2 ** zoom;

  return (
    (lon + 180) /
    360 *
    n
  );

}


function latToTileY(lat, zoom) {

  const rad =
    THREE.MathUtils.degToRad(lat);

  const n =
    2 ** zoom;

  return (
    1 -
    Math.log(
      Math.tan(rad) +
      1 / Math.cos(rad)
    ) /
    Math.PI
  ) /
  2 *
  n;

}


// ------------------------------------------------------------
// DOWNLOAD ONE TERRAIN TILE
// ------------------------------------------------------------

async function loadTile(
  zoom,
  x,
  y
) {

  const url =
    `https://s3.amazonaws.com/` +
    `elevation-tiles-prod/terrarium/` +
    `${zoom}/${x}/${y}.png`;


  const response =
    await fetch(url);


  if (!response.ok) {

    throw new Error(
      `Terrain tile failed ${response.status}`
    );

  }


  const blob =
    await response.blob();


  const bitmap =
    await createImageBitmap(blob);


  const canvas =
    document.createElement('canvas');


  canvas.width =
    TILE_SIZE;

  canvas.height =
    TILE_SIZE;


  const ctx =
    canvas.getContext(
      '2d',
      {
        willReadFrequently:
          true
      }
    );


  ctx.drawImage(
    bitmap,
    0,
    0
  );


  const data =
    ctx.getImageData(
      0,
      0,
      TILE_SIZE,
      TILE_SIZE
    ).data;


  bitmap.close();


  return data;

}


// ------------------------------------------------------------
// TERRAIN CLASS
// ------------------------------------------------------------

export class RealTerrain {

  constructor({

    center,
    radius,
    zoom = 15,
    verticalScale = 1

  }) {

    this.center =
      center;

    this.radius =
      radius;

    this.zoom =
      zoom;

    this.verticalScale =
      verticalScale;


    this.cosLat =
      Math.cos(
        THREE.MathUtils.degToRad(
          center.lat
        )
      );


    this.tiles =
      new Map();


    this.baseElevation =
      0;

  }


  // ----------------------------------------------------------
  // LOAD ALL TILES NEEDED AROUND DISTRICT
  // ----------------------------------------------------------

  async load() {

    const dLat =
      this.radius /
      M_LAT;


    const dLon =
      this.radius /
      (
        M_LON *
        this.cosLat
      );


    const south =
      this.center.lat -
      dLat;


    const north =
      this.center.lat +
      dLat;


    const west =
      this.center.lon -
      dLon;


    const east =
      this.center.lon +
      dLon;


    const x0 =
      Math.floor(
        lonToTileX(
          west,
          this.zoom
        )
      );


    const x1 =
      Math.floor(
        lonToTileX(
          east,
          this.zoom
        )
      );


    const y0 =
      Math.floor(
        latToTileY(
          north,
          this.zoom
        )
      );


    const y1 =
      Math.floor(
        latToTileY(
          south,
          this.zoom
        )
      );


    const jobs = [];


    for (
      let x = x0;
      x <= x1;
      x++
    ) {

      for (
        let y = y0;
        y <= y1;
        y++
      ) {

        jobs.push(

          loadTile(
            this.zoom,
            x,
            y
          ).then(
            (data) => {

              this.tiles.set(
                `${x}/${y}`,
                data
              );

            }
          )

        );

      }

    }


    await Promise.all(jobs);


    this.baseElevation =
      this.rawElevation(
        this.center.lat,
        this.center.lon
      );


    console.log(
      'Terrain loaded:',
      this.tiles.size,
      'tiles'
    );


    console.log(
      'Centre elevation:',
      this.baseElevation.toFixed(1),
      'm'
    );


    return this;

  }


  // ----------------------------------------------------------
  // READ TERRARIUM PIXEL
  // ----------------------------------------------------------

  pixelElevation(
    globalPixelX,
    globalPixelY
  ) {

    let tileX =
      Math.floor(
        globalPixelX /
        TILE_SIZE
      );


    let tileY =
      Math.floor(
        globalPixelY /
        TILE_SIZE
      );


    let px =
      Math.floor(
        globalPixelX -
        tileX *
        TILE_SIZE
      );


    let py =
      Math.floor(
        globalPixelY -
        tileY *
        TILE_SIZE
      );


    px =
      THREE.MathUtils.clamp(
        px,
        0,
        TILE_SIZE - 1
      );


    py =
      THREE.MathUtils.clamp(
        py,
        0,
        TILE_SIZE - 1
      );


    const data =
      this.tiles.get(
        `${tileX}/${tileY}`
      );


    if (!data) {
      return this.baseElevation;
    }


    const index =
      (
        py *
        TILE_SIZE +
        px
      ) *
      4;


    const R =
      data[index];


    const G =
      data[index + 1];


    const B =
      data[index + 2];


    return (
      R * 256 +
      G +
      B / 256 -
      32768
    );

  }


  // ----------------------------------------------------------
  // BILINEAR ELEVATION SAMPLE
  // ----------------------------------------------------------

  rawElevation(
    lat,
    lon
  ) {

    const tx =
      lonToTileX(
        lon,
        this.zoom
      );


    const ty =
      latToTileY(
        lat,
        this.zoom
      );


    const gx =
      tx *
      TILE_SIZE;


    const gy =
      ty *
      TILE_SIZE;


    const x0 =
      Math.floor(gx);


    const y0 =
      Math.floor(gy);


    const fx =
      gx - x0;


    const fy =
      gy - y0;


    const a =
      this.pixelElevation(
        x0,
        y0
      );


    const b =
      this.pixelElevation(
        x0 + 1,
        y0
      );


    const c =
      this.pixelElevation(
        x0,
        y0 + 1
      );


    const d =
      this.pixelElevation(
        x0 + 1,
        y0 + 1
      );


    const top =
      THREE.MathUtils.lerp(
        a,
        b,
        fx
      );


    const bottom =
      THREE.MathUtils.lerp(
        c,
        d,
        fx
      );


    return THREE.MathUtils.lerp(
      top,
      bottom,
      fy
    );

  }


  // ----------------------------------------------------------
  // CITYVERSE X/Z → HEIGHT
  // ----------------------------------------------------------

  heightAt(
    x,
    z
  ) {

    const lat =
      this.center.lat -
      z /
      M_LAT;


    const lon =
      this.center.lon +
      x /
      (
        M_LON *
        this.cosLat
      );


    const elevation =
      this.rawElevation(
        lat,
        lon
      );


    return (
      elevation -
      this.baseElevation
    ) *
    this.verticalScale;

  }


  // ----------------------------------------------------------
  // BUILD THREE.JS TERRAIN
  // ----------------------------------------------------------

  createMesh(
    material,
    {
      size = 1400,
      segments = 128
    } = {}
  ) {

    const geometry =
      new THREE.PlaneGeometry(
        size,
        size,
        segments,
        segments
      );


    geometry.rotateX(
      -Math.PI / 2
    );


    const pos =
      geometry.attributes.position;


    for (
      let i = 0;
      i < pos.count;
      i++
    ) {

      const x =
        pos.getX(i);


      const z =
        pos.getZ(i);


      const y =
        this.heightAt(
          x,
          z
        );


      pos.setY(
        i,
        y
      );

    }


    pos.needsUpdate =
      true;


    geometry.computeVertexNormals();


    const mesh =
      new THREE.Mesh(
        geometry,
        material
      );


    mesh.receiveShadow =
      true;


    mesh.name =
      'RealIbadanTerrain';


    return mesh;

  }

}