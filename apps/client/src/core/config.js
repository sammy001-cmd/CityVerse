// ============================================================
// CITYVERSE — CLIENT RUNTIME CONFIGURATION
// ============================================================

export const P =
  new URLSearchParams(
    window.location.search
  );


// ============================================================
// WORLD
// ============================================================

export const CENTER = Object.freeze({
  lat: 7.3962,
  lon: 3.8968
});

export const RADIUS = 450;

export const M_LON = 111320;
export const M_LAT = 110540;


// ============================================================
// GRAPHICS
// ============================================================

export const LOW =
  P.has('low');

export const SHADOWS =
  !LOW &&
  P.get('shadows') !== '0';


// ============================================================
// STREET LIGHTS
// ============================================================

export const LAMP_URL =
  '/assets/models/street-lamp/street_lamp_01_4k.gltf';

export const LAMP_SCALE = 2;

export const LAMP_MAX =
  Number(
    P.get('lamps') ?? 8
  );


// ============================================================
// PLAYER
// ============================================================

export const PLAYER_MODEL_URL =
  '/assets/models/characters/player.glb';

export const PLAYER_HEIGHT =
  1.75;


// ============================================================
// PLAYER MOVEMENT + ANIMATION
// ============================================================

export const WALK_SPEED =
  2.2;

export const WALK_ANIM_SPEED =
  1.58;

export const RUN_SPEED =
  5.0;

export const RUN_ANIM_SPEED =
  4.1;

export const USE_JUMP_CLIP =
  false;

export const ANIM_DIR =
  '/assets/models/characters/anims/';