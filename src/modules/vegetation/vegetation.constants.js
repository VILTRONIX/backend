export const MODIS_SLUG = 'nasa-modis-mod13q1-061';
// Opaque identifier for this approved pair of summaries; it does not define or infer geometry.
export const AOI_KEY = 'modis-summary-aoi-v1';
export const PILOT_GEOID = '19169';
export const RESOLUTIONS = ['16day', 'monthly'];
export const SPATIAL_PROVENANCE = Object.freeze({
  spatialScope: 'bounding_box_aoi', countyMaskApplied: false, exactCountyStatistics: false,
  countyCoverageStatus: 'unverified', studyAreaRelationship: 'pilot_context_only',
});
export const LIMITATIONS = [
  'Bounding-box AOI summaries; no exact Story County polygon mask was applied. The original AOI footprint is not encoded in the CSVs.',
  'Missing measurements remain null. Eighteen composites have zero quality-valid pixels; their winter occurrence does not establish a cause.',
  'February 2019 and January 2021 have monthly rows with no valid measurements; no interpolation or zero replacement is performed.',
  'Monthly summaries aggregate existing composite pixel-observations and are not an independent satellite product.',
  'Raw QA, scaling history, units, and spatial footprint are not independently established from these CSVs. Upstream processing rules are user-provided provenance.',
  'These area-level summaries cannot render pixel-level raster maps. Native product resolution is not a claim of field-level or exact county coverage.',
];
export const PROCESSING_METADATA = Object.freeze({
  provider: 'NASA', product: 'MOD13Q1.061', nativeSpatialResolutionMeters: 250,
  scaling: 'already_decoded_no_rescaling',
  units: { ndvi: 'dimensionless', evi: 'dimensionless', basis: 'user_processing_provenance' },
  qa: { pixelReliability: 0, modlandQa: 0, modlandBits: [0, 1], basis: 'upstream_user_provided_rules; exported_histograms_reconciled' },
  crs: null, crsStatus: 'not_present_in_csv',
  calendarDateStorage: 'UTC_midnight_calendar_key_not_an_observation_timezone_assertion',
  monthlyAggregation: 'source_pooled_valid_pixel_observations; monthly_medians_and_std_copied_without_recalculation',
});
export const SOURCE_MAPPING = Object.freeze({
  ndvi_mean: 'ndviMean', ndvi_median: 'ndviMedian', ndvi_std: 'ndviStd',
  ndvi_valid_pixel_count: 'ndviValidPixelCount', ndvi_valid_pixel_percentage: 'ndviValidPixelPercentage',
  evi_mean: 'eviMean', evi_median: 'eviMedian', evi_std: 'eviStd',
  evi_valid_pixel_count: 'eviValidPixelCount', evi_valid_pixel_percentage: 'eviValidPixelPercentage',
  total_pixel_count: 'totalPixelCount', base_valid_pixel_count: 'baseValidPixelCount', quality_valid_pixel_count: 'qualityValidPixelCount',
  observation_count: 'observationCount', total_pixel_observations: 'totalPixelObservations',
  vi_usefulness_distribution_before_filter: 'viUsefulnessDistributionBeforeFilter',
  vi_usefulness_distribution_after_filter: 'viUsefulnessDistributionAfterFilter',
});
export const APPROVED_SOURCES = Object.freeze({
  '16day': {
    fileName: 'modis_16day_aoi_summary.csv', sizeBytes: 51686, rowCount: 207,
    checksum: '0a2bb581122774e5e6bc69319e1d3758e37c98947f362677098133748719edc7',
    start: '2017-01-01', end: '2025-12-19', nullCount: 18,
    headers: ['date', 'ndvi_mean', 'ndvi_median', 'ndvi_std', 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_mean', 'evi_median', 'evi_std', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage', 'total_pixel_count', 'base_valid_pixel_count', 'quality_valid_pixel_count', 'vi_usefulness_distribution_before_filter', 'vi_usefulness_distribution_after_filter'],
  },
  monthly: {
    fileName: 'modis_monthly_aoi_summary.csv', sizeBytes: 17695, rowCount: 108,
    checksum: 'f411afa54c2d8fee70251958fb73ec50c86dd2cb95325670ead7f9a323579465',
    start: '2017-01', end: '2025-12', nullCount: 2,
    headers: ['month', 'observation_count', 'total_pixel_observations', 'ndvi_mean', 'ndvi_median', 'ndvi_std', 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_mean', 'evi_median', 'evi_std', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage'],
  },
});
