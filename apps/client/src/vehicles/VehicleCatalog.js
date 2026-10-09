// ============================================================
// CITYVERSE — VEHICLE CATALOG
//
// Adding a new vehicle should normally happen here.
// Physics/driving code should not need to be rewritten.
// ============================================================

export const VEHICLE_TYPES = Object.freeze({

  car: {
    name: 'Saloon Car',

    hw: 0.9,
    hh: 0.45,
    hl: 2.15,

    mass: 1200,

    wheelR: 0.34,
    wheelW: 0.22,

    rest: 0.35,
    stiff: 30,
    slip: 2.2,

    engine: 2200,
    maxKmh: 110,
    steerMax: 0.55,

    settle: 0.274,

    modelUrl: null,

    modelHasWheels: false
  },


  carry: {
    name: 'Suzuki Carry',

    hw: 0.8,
    hh: 0.65,
    hl: 1.73,

    mass: 850,

    wheelR: 0.26,
    wheelW: 0.28,

    rest: 0.3,
    stiff: 28,
    slip: 2.4,

    engine: 1700,
    maxKmh: 95,
    steerMax: 0.6,

    settle: 0.217,

    wheelX: 0.62,
    wheelZFront: 0.96,
    wheelZRear: -0.94,

    modelUrl:
      '/assets/models/vehicles/suzuki-carry.glb',

    modelWheelCenterY: 0.16,

    fallback: 'car'
  },


  danfo: {
    name: 'Danfo Bus',

    hw: 1.0,
    hh: 0.85,
    hl: 2.6,

    mass: 2200,

    wheelR: 0.38,
    wheelW: 0.26,

    rest: 0.4,
    stiff: 34,
    slip: 2.0,

    engine: 3300,
    maxKmh: 75,
    steerMax: 0.5,

    settle: 0.332,

    modelUrl: null,

    modelHasWheels: false
  }

});


export function getVehicleType(type) {
  const vehicle =
    VEHICLE_TYPES[type];

  if (!vehicle) {
    throw new Error(
      `Unknown CityVerse vehicle type: ${type}`
    );
  }

  return vehicle;
}


export function getVehicleTypes() {
  return Object.keys(
    VEHICLE_TYPES
  );
}