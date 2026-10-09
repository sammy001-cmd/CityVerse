export const createPropertyState = () => ({
  id: null,

  worldBuildingId: null,

  ownerId: null,

  type: 'house',

  status: 'available',

  price: 0,

  interiorTemplateId: null,

  customization: {
    wallColors: {},
    furniture: []
  }
});
