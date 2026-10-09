export const GAME_VERSION = '0.1.0';

export const WORLD_TILE_SIZE = 250;

export const CITYVERSE_VERSION = GAME_VERSION;

export const WORLD = {
  TILE_SIZE: WORLD_TILE_SIZE
};

export const PLAYER = {
  HEIGHT: 1.75,
  WALK_SPEED: 2.2,
  RUN_SPEED: 5.0
};

export const CURRENCY = {
  CODE: 'NGN',
  SYMBOL: '₦',
  STARTING_BALANCE: 500000
};

export const ECONOMY = {
  CURRENCY: CURRENCY.CODE,
  SYMBOL: CURRENCY.SYMBOL,
  STARTING_BALANCE: CURRENCY.STARTING_BALANCE
};

export const NETWORK = {
  TICK_RATE: 20,
  SERVER_TICK_RATE: 20,
  SNAPSHOT_RATE: 10,
  INTERPOLATION_DELAY_MS: 100
};

export const PROPERTY_TYPES = {
  HOUSE: 'house',
  APARTMENT: 'apartment',
  SHOP: 'shop',
  OFFICE: 'office'
};
