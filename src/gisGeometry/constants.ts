import contract from './geometry_contract.json';

// Vendored unchanged from SpeleoDB 67c67592e1a1017c7aab40a28ddde1e532fea2f7:
// speleodb/gis/geometry_contract.json. SHA256:
// 9ad38c83e2f30dfe2fa3603637f937c965c76dd2e55a1b10a2cd8d3baf41ef36
export const GIS_GEOMETRY_CONTRACT = Object.freeze(contract);
export const GIS_GEOMETRY_RENDER = Object.freeze({
  FILL_OPACITY: 0.175, LINE_OPACITY: 0.95, OUTLINE_WIDTH: 1.5, LINE_WIDTH: 2.5,
});
export const GIS_GEOMETRY_ENDPOINT = '/api/v2/gis-geometries/';
