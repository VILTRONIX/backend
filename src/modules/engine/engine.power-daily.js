import { serialize } from 'node:v8';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../../utils/appError.js';
import { parseCsv } from '../../utils/csv.js';
import { openSource, readDocument, checksum, fail, isRecord } from './engine.files.js';
import { readBoundedBytes, decodeCsvValue } from './engine.csv.js';
import { compileRecordSchema, validDate } from './engine.schema.js';
import { parseEngineQuery } from './engine.query.js';

export const DAILY_ID = 'power_daily_context';
const PREFIX = 'data/processed/features/supplemental/';
const UNITS = Object.freeze({ T2M_MAX: 'C', T2M_MIN: 'C', T2M: 'C', RH2M: '%', WS10M: 'm/s',
  ALLSKY_SFC_SW_DWN: 'MJ/m^2/day', PRECTOTCORR: 'mm/day', PS: 'kPa' });
const reject = (reason) => fail('validation_failed', reason);
const guardsFor = (guards) => async () => { await Promise.all(guards.map((guard) => guard())); };

export function parseDailyQuery(query = {}) {
  const bad = () => { throw new AppError(400, 'INVALID_ENGINE_QUERY', 'Daily POWER accepts valid daily startDate, endDate, page and limit only.'); };
  if (Object.keys(query).some((key) => !['startDate', 'endDate', 'page', 'limit'].includes(key))) bad();
  const parsed = parseEngineQuery(query);
  if ([parsed.startDate, parsed.endDate].some((date) => date !== undefined && !validDate(date, 'day'))) bad();
  return parsed;
}

export function validateDailyTable(table, metadata) {
  const m = metadata;
  if (!isRecord(m) || m.dataset_name !== DAILY_ID || m.source !== 'NASA POWER Daily Point API' || m.time_standard !== 'UTC'
    || m.date_coverage?.start !== '2021-01-01' || m.date_coverage?.end !== '2025-12-31'
    || m.validation?.status !== 'PASS' || m.validation.actual_records !== 1826 || m.validation.expected_records !== 1826
    || m.returned_coordinates?.latitude !== 42.0375 || m.returned_coordinates?.longitude !== -93.4661
    || m.requested_coordinates?.latitude !== 42.0375 || m.requested_coordinates?.longitude !== -93.4661
    || m.missing_value_policy?.source_fill_value !== -999 || m.missing_value_policy.imputation !== 'none'
    || !isDeepStrictEqual(m.primary_key, ['date']) || !isRecord(m.parameter_metadata)) reject('invalid_daily_metadata');
  const units = { ...UNITS };
  if (m.optional_T2MDEW?.available === true) units.T2MDEW = 'C';
  if (!isDeepStrictEqual(Object.keys(m.parameter_metadata).sort(), Object.keys(units).sort())
    || Object.entries(units).some(([key, unit]) => m.parameter_metadata[key]?.unit !== unit)) reject('daily_parameter_contract_mismatch');
  const columns = ['date', 'latitude', 'longitude', 'YEAR', 'DOY', ...Object.keys(units)];
  if (!isDeepStrictEqual(m.columns, columns) || !isDeepStrictEqual(table.headers, columns)) reject('csv_header_mismatch');
  const properties = { date: { type: 'string', format: 'date' }, latitude: { type: 'number', const: 42.0375 },
    longitude: { type: 'number', const: -93.4661 }, YEAR: { type: 'integer' }, DOY: { type: 'integer', minimum: 1, maximum: 366 } };
  for (const key of Object.keys(units)) properties[key] = { type: ['number', 'null'] };
  const compiled = compileRecordSchema({ type: 'object', properties, required: columns, additionalProperties: false });
  const records = [], dates = new Set(), missing = Object.fromEntries(Object.keys(units).map((key) => [key, 0]));
  const fills = { ...missing };
  if (table.rows.length !== 1826) reject('daily_record_count_mismatch');
  for (const [index, cells] of table.rows.entries()) {
    const record = {};
    for (const [i, field] of columns.entries()) {
      let value = decodeCsvValue(cells[i], properties[field], { null_tokens: [''] });
      if (Object.hasOwn(units, field)) {
        if (value === -999) { value = null; fills[field] += 1; }
        if (value === null) missing[field] += 1;
      }
      record[field] = value;
    }
    if (!compiled.validate(record)) reject('invalid_daily_record');
    if (dates.has(record.date)) reject('duplicate_daily_date'); dates.add(record.date);
    const expected = new Date(Date.UTC(2021, 0, 1 + index)).toISOString().slice(0, 10);
    const doyDate = new Date(Date.UTC(record.YEAR, 0, record.DOY));
    if (record.date !== expected || doyDate.getUTCFullYear() !== record.YEAR || doyDate.toISOString().slice(0, 10) !== record.date) reject('daily_calendar_mismatch');
    for (const field of Object.keys(units)) {
      const range = m.validation.screen_ranges?.[field];
      if (record[field] !== null && Array.isArray(range) && (record[field] < range[0] || record[field] > range[1])) reject('daily_screen_range_failure');
    }
    if (record.T2M_MIN !== null && record.T2M_MAX !== null && record.T2M_MIN > record.T2M_MAX
      || record.T2M !== null && record.T2M_MIN !== null && record.T2M < record.T2M_MIN
      || record.T2M !== null && record.T2M_MAX !== null && record.T2M > record.T2M_MAX) reject('daily_temperature_order_failure');
    records.push(record);
  }
  for (const field of Object.keys(units)) {
    if (m.validation.missing_values?.[field] !== undefined && m.validation.missing_values[field] !== missing[field]
      || m.validation.fill_values?.[field] !== undefined && m.validation.fill_values[field] !== fills[field]) reject('daily_missing_count_mismatch');
  }
  return { records, missing, fills, fields: Object.fromEntries(columns.map((field) => [field, {
    type: properties[field].type, unit: units[field] ?? m.coordinate_units?.[field] ?? null,
    description: m.parameter_metadata[field]?.description ?? null,
  }])) };
}

export async function loadPowerDaily(paths, limits) {
  if (!paths.engineRoot) fail('missing_file', 'engine_root_not_configured');
  const guards = [], hashes = {};
  async function bytes(name, maximum) {
    const source = await openSource(paths.engineRoot, PREFIX + name);
    try {
      const content = await readBoundedBytes(source, maximum, 'daily_file_size_limit');
      await source.verifyUnchanged(); guards.push(source.verifyPathUnchanged); hashes[name] = checksum(content); return content;
    } finally { await source.close(); }
  }
  const declarations = new TextDecoder('utf-8', { fatal: true }).decode(await bytes('checksums.sha256', limits.manifestBytes));
  const expected = new Map(declarations.trim().split(/\r?\n/).map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line); if (!match) reject('invalid_daily_checksums'); return [match[2], match[1]];
  }));
  const metadataDocument = await readDocument(paths.engineRoot, PREFIX + 'power_daily_context_metadata.json', {
    maxBytes: limits.manifestBytes, missingStatus: 'missing_file', invalidStatus: 'validation_failed',
  });
  const metadata = metadataDocument.value; guards.push(metadataDocument.verifyUnchanged);
  hashes['power_daily_context_metadata.json'] = metadataDocument.checksum;
  await bytes('power_daily_context_audit.md', limits.schemaBytes);
  const csv = await bytes('power_daily_context.csv', limits.csvBytes);
  for (const name of ['power_daily_context.csv', 'power_daily_context_metadata.json', 'power_daily_context_audit.md']) {
    if (expected.get(name) !== hashes[name]) reject('daily_checksum_mismatch');
  }
  if (metadata.checksums?.output_csv !== hashes['power_daily_context.csv']) reject('daily_checksum_mismatch');
  const table = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(csv), { maxRecords: limits.records, maxColumns: 1000, maxFieldBytes: limits.recordBytes });
  const validated = validateDailyTable(table, metadata);
  const dataset = { id: DAILY_ID, optional: true, status: 'available', structurallyReady: true, recordCount: validated.records.length,
    verification: { file: 'verified', metadata: 'verified', records: 'verified', scientific: 'not_assessed' },
    metadata: { source: metadata.source, temporalGrain: metadata.temporal_grain ?? null, timeStandard: metadata.time_standard,
      coordinates: metadata.returned_coordinates, coverage: metadata.date_coverage, primaryKey: metadata.primary_key,
      sourceGridCellCenterCoordinates: metadata.source_grid_cell_center_coordinates ?? null,
      coordinateNote: metadata.coordinate_note ?? null, spatialScope: metadata.spatial_interpretation ?? null,
      fields: validated.fields, missingValues: validated.missing, fillValues: validated.fills,
      missingValuePolicy: { sourceFillValue: -999, responseMissingValue: null, imputation: 'none' },
      limitations: ['One representative point, not a county-wide average or field measurement.',
        'Separate from the four existing POWER monthly locations; no spatial averaging or substitution.',
        'Historical daily UTC source-product evidence, not a forecast or scenario-performance evaluation.',
        'No ET0, ETc, irrigation requirement, water savings, yield prediction or recommendation is calculated.'] },
    provenance: { checksumAlgorithm: 'sha256', checksum: hashes['power_daily_context.csv'],
      metadataChecksum: metadataDocument.checksum, auditChecksum: hashes['power_daily_context_audit.md'],
      checksumsFileChecksum: hashes['checksums.sha256'], rawSourceChecksum: metadata.checksums.source_csv ?? null,
      originalSourceVerification: 'not_independently_verified' } };
  const verify = guardsFor(guards); await verify();
  const encodedMetadata = serialize(dataset), records = serialize(validated.records);
  return { metadata: encodedMetadata, records, byteSize: encodedMetadata.length + records.length, recordCount: validated.records.length, verify };
}
