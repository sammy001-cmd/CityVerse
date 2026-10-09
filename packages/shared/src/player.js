export const createPlayerState = () => ({
  id: null,

  position: {
    x: 0,
    y: 0,
    z: 0
  },

  rotation: 0,

  movement: {
    state: 'idle',
    speed: 0
  },

  vehicleId: null,

  propertyId: null,

  status: 'online'
});
