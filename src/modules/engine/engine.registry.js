const definitions = [
  ['power_monthly', 'NASA', 'POWER', 'Monthly climate feature access.', false, '/climate/monthly'],
  ['modis_monthly', 'NASA', 'MODIS', 'Monthly vegetation feature access.', false, '/vegetation/monthly'],
  ['modis_16day', 'NASA', 'MODIS', '16-day vegetation feature access.', false, '/vegetation/16day'],
  ['usda_annual', 'USDA', 'USDA', 'Annual crop feature access.', false, '/crops/annual'],
  ['usda_crop_classes', 'USDA', 'USDA', 'Crop-class feature access.', false, '/crops/classes'],
  ['usda_crop_transitions', 'USDA', 'USDA', 'Crop-transition feature access.', false, '/crops/transitions'],
  ['soil_map_units', 'USDA', 'SSURGO', 'Read-only soil map-unit attribute lookup.', false, '/soil/map-units'],
  ['merra2_context', 'NASA', 'MERRA-2', 'Optional climate context feature access.', true, '/climate/merra2'],
];

// Backend logical identifiers, not assertions about upstream filenames, IDs, columns, or units.
export const ENGINE_DATASETS = Object.freeze(definitions.map(([id, provider, source, purpose, optional, route]) => Object.freeze({
  id, provider, source, purpose, optional, route,
})));
export const METADATA_REQUIREMENTS = Object.freeze(['source', 'observationPeriod', 'spatialScope', 'provenance', 'limitations']);
