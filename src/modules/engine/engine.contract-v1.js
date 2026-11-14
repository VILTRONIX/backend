import { isDeepStrictEqual } from 'node:util';
import { fail, isRecord, validateReference } from './engine.files.js';
import { MANIFEST_PROFILE, publicText } from './engine.manifest.js';
import { validateCsvSchema, schemaTypes } from './engine.csv.js';
import { validDate } from './engine.schema.js';

export const FINAL_DATASET_IDS = Object.freeze({
  nasa_power_monthly_features: 'power_monthly', modis_monthly_features: 'modis_monthly', modis_16day_features: 'modis_16day',
  crop_annual_features: 'usda_annual', crop_class_annual_features: 'usda_crop_classes', crop_transition_features: 'usda_crop_transitions',
  soil_mapunit_features: 'soil_map_units', merra2_monthly_context_features: 'merra2_context',
});
const mappings = {
  power_monthly: { date: { field: 'month_start', granularity: 'day' }, year: 'year' },
  modis_monthly: { date: { field: 'month', granularity: 'month' } }, modis_16day: { date: { field: 'date', granularity: 'day' } },
  usda_annual: { year: 'year' }, usda_crop_classes: { year: 'year' }, usda_crop_transitions: {},
  soil_map_units: { mapUnit: 'mukey' }, merra2_context: { date: { field: 'date', granularity: 'day' } },
};
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function publicCoverage(coverage) {
  const result = {};
  for (const key of ['start', 'end']) if (coverage[key] !== undefined) {
    if (!validDate(coverage[key], 'month') && !validDate(coverage[key], 'day')) fail('validation_failed', 'invalid_coverage_declaration');
    result[key] = coverage[key];
  }
  for (const key of ['start_year', 'end_year', 'months_per_point', 'months_per_cell', 'observations_per_year']) if (coverage[key] !== undefined) {
    if (!Number.isSafeInteger(coverage[key]) || coverage[key] < 1 || coverage[key] > 9999) fail('validation_failed', 'invalid_coverage_declaration');
    result[key] = coverage[key];
  }
  if (coverage.kind !== undefined) {
    if (coverage.kind !== 'static') fail('validation_failed', 'invalid_coverage_declaration');
    result.kind = coverage.kind;
  }
  if (coverage.year_pairs !== undefined) {
    if (!Array.isArray(coverage.year_pairs) || coverage.year_pairs.length > 1000 || coverage.year_pairs.some((pair) => !Array.isArray(pair) || pair.length !== 2
      || pair.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 9999) || pair[1] !== pair[0] + 1)) fail('validation_failed', 'invalid_coverage_declaration');
    result.year_pairs = structuredClone(coverage.year_pairs);
  }
  return result;
}
function scopedReference(reference, prefix) {
  validateReference(reference);
  if (!reference.startsWith(prefix + '/')) fail('validation_failed', 'reference_outside_approved_root');
  return validateReference(reference.slice(prefix.length + 1));
}

export function adaptContractV1(manifest) {
  if (!isRecord(manifest) || manifest.contract_version !== '1.0.0' || !Array.isArray(manifest.datasets) || manifest.datasets.length > 8
    || !isRecord(manifest.county_scope) || manifest.county_scope.geoid !== '19169' || !publicText(manifest.county_scope.name)) {
    fail('validation_failed', 'unsupported_manifest_contract');
  }
  const seen = new Set();
  const datasets = manifest.datasets.map((entry) => {
    if (!isRecord(entry) || !Object.hasOwn(FINAL_DATASET_IDS, entry.dataset_name) || seen.has(entry.dataset_name)) fail('validation_failed', 'invalid_manifest_references');
    seen.add(entry.dataset_name);
    if (!Number.isSafeInteger(entry.row_count) || entry.row_count < 1 || !sha(entry.output_sha256) || !sha(entry.schema_sha256) || !sha(entry.source_sha256)
      || !Array.isArray(entry.primary_key) || !entry.primary_key.length || new Set(entry.primary_key).size !== entry.primary_key.length
      || !Array.isArray(entry.nullable_fields) || !isRecord(entry.coverage)
      || entry.optional !== (entry.dataset_name === 'merra2_monthly_context_features')
      || !publicText(entry.temporal_grain) || !publicText(entry.spatial_grain)
      || !isRecord(entry.provenance) || !publicText(entry.provenance.transformation)) fail('validation_failed', 'invalid_final_descriptor');
    const id = FINAL_DATASET_IDS[entry.dataset_name];
    return {
      logicalId: id, id: entry.dataset_name,
      files: [{ id: entry.dataset_name, path: scopedReference(entry.path, 'data/processed/features'),
        schema: scopedReference(entry.schema_path, 'src/schemas'), format: 'csv',
        expectedChecksum: entry.output_sha256, expectedSchemaChecksum: entry.schema_sha256 }],
      fieldMappings: structuredClone(mappings[id]),
      metadata: {
        source: entry.dataset_name, spatialScope: entry.spatial_grain,
        observationPeriod: { start: entry.coverage.start ?? (entry.coverage.start_year === undefined ? null : String(entry.coverage.start_year)),
          end: entry.coverage.end ?? (entry.coverage.end_year === undefined ? null : String(entry.coverage.end_year)) },
        provenance: [`${entry.dataset_name}@1.0.0`, `sha256:${entry.source_sha256}`],
        limitations: entry.limitations ?? [],
      },
      finalContract: { entry: structuredClone(entry), county: structuredClone(manifest.county_scope) },
    };
  });
  return { contractVersion: MANIFEST_PROFILE, sourceContractVersion: '1.0.0', datasets };
}

export function verifyFinalSchema(descriptor, schema) {
  const { entry, county } = descriptor.finalContract, dataset = schema['x-dataset'];
  if (!isRecord(dataset)) fail('invalid_schema', 'dataset_schema_metadata_missing');
  for (const key of ['dataset_name', 'path', 'schema_path', 'source_path', 'primary_key', 'optional', 'temporal_grain', 'spatial_grain', 'provenance']) {
    if (!isDeepStrictEqual(dataset[key], entry[key])) fail('invalid_schema', 'schema_manifest_mismatch');
  }
  if (!isDeepStrictEqual(dataset.county_scope, county) || !isRecord(dataset.validation)
    || dataset.validation.expected_row_count !== entry.row_count || !isDeepStrictEqual(dataset.validation.coverage, entry.coverage)
    || !isRecord(dataset.validation.expected_missing_counts)
    || !isDeepStrictEqual(Object.keys(dataset.validation.expected_missing_counts).sort(), Object.keys(schema.properties).sort())
    || !Array.isArray(dataset.warnings) || !dataset.warnings.every(publicText)
    || !isDeepStrictEqual([...entry.nullable_fields].sort(), Object.keys(schema.properties).filter((key) => schemaTypes(schema.properties[key]).includes('null')).sort())) {
    fail('invalid_schema', 'schema_manifest_mismatch');
  }
  for (const key of entry.primary_key) {
    if (!Object.hasOwn(schema.properties, key) || !schema.required.includes(key) || schemaTypes(schema.properties[key]).includes('null')) fail('invalid_schema', 'invalid_primary_key');
  }
  for (const count of Object.values(dataset.validation.expected_missing_counts)) {
    if (!Number.isSafeInteger(count) || count < 0 || count > entry.row_count) fail('invalid_schema', 'invalid_missing_counts');
  }
  const csv = validateCsvSchema(schema);
  return {
    contractVersion: '1.0.0', countyScope: { name: county.name, geoid: county.geoid }, coverage: publicCoverage(entry.coverage),
    temporalGrain: entry.temporal_grain, spatialGrain: entry.spatial_grain,
    primaryKey: [...entry.primary_key], nullableFields: [...entry.nullable_fields],
    fields: Object.fromEntries(Object.entries(schema.properties).map(([key, property]) => {
      if (property['x-unit'] !== undefined && property['x-unit'] !== null && !publicText(property['x-unit'])
        || property.description !== undefined && !publicText(property.description)) fail('invalid_schema', 'invalid_public_schema_metadata');
      return [key, { type: structuredClone(property.type), unit: property['x-unit'] ?? null,
        ...(property.description === undefined ? {} : { description: property.description }),
        ...(typeof property['x-content'] === 'string' && publicText(property['x-content']) ? { content: property['x-content'] } : {}) }];
    })),
    csv: { encoding: csv.encoding, delimiter: csv.delimiter, orderedColumns: [...csv.ordered_columns],
      nullTokens: [...csv.null_tokens], booleanTokens: { ...csv.boolean_tokens } },
    limitations: [...new Set([...descriptor.metadata.limitations, ...dataset.warnings])],
    sourceMetadata: { datasetName: entry.dataset_name, sourceChecksum: entry.source_sha256,
      transformation: entry.provenance.transformation, originalSourceVerification: 'not_independently_verified' },
  };
}
