import { access, readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Audit only: no database imports, connections, source writes, scaling, or QA filtering.
export const SOURCES = {
  '16day': path.join('processed', 'modis', 'modis_16day_aoi_summary.csv'),
  monthly: path.join('processed', 'modis', 'modis_monthly_aoi_summary.csv'),
};
const REPORT_PATH = fileURLToPath(new URL('../reports/modis_backend_source_audit.md', import.meta.url));
const MEASUREMENTS = ['ndvi_mean', 'ndvi_median', 'ndvi_std', 'evi_mean', 'evi_median', 'evi_std'];
const QA_FIELDS = ['vi_usefulness_distribution_before_filter', 'vi_usefulness_distribution_after_filter'];
const EXPECTED_ROWS = { '16day': 207, monthly: 108 };
const TOLERANCE = 1e-9;

export { parseCsv };
import { parseCsv } from '../src/utils/csv.js';

export function isDateKey(value, resolution) {
  const pattern = resolution === 'monthly' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(value)) return false;
  const day = resolution === 'monthly' ? `${value}-01` : value;
  const parsed = new Date(`${day}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

export function numericValue(raw) {
  const text = raw.trim();
  if (!text) return null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) throw new Error('Expected a finite decimal number.');
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error('Expected a finite decimal number.');
  return value;
}

export function statistics(values) {
  const result = { count: 0, min: null, max: null, mean: null, sum: 0 };
  for (const value of values) if (typeof value === 'number' && Number.isFinite(value)) {
    result.count += 1;
    result.min = result.min === null ? value : Math.min(result.min, value);
    result.max = result.max === null ? value : Math.max(result.max, value);
    result.sum += value;
  }
  result.mean = result.count ? result.sum / result.count : null;
  return result;
}

function duplicates(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value, count]) => ({ value, count }));
}
const histogram = (values) => {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return result;
};
const close = (actual, expected) => actual === expected || (typeof actual === 'number' && typeof expected === 'number' && Math.abs(actual - expected) <= TOLERANCE);

export function auditCsv(text, resolution, { allowMeasurementNaN = false } = {}) {
  const { headers, rows } = parseCsv(text);
  const dateField = resolution === 'monthly' ? 'month' : 'date';
  const required = resolution === 'monthly'
    ? ['month', 'observation_count', 'total_pixel_observations', ...MEASUREMENTS, 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage']
    : ['date', ...MEASUREMENTS, 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage', 'total_pixel_count', 'base_valid_pixel_count', 'quality_valid_pixel_count', ...QA_FIELDS];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length) throw new Error(`The inspected ${resolution} schema is missing required columns: ${missing.join(', ')}.`);
  const unknown = headers.filter((field) => !required.includes(field));
  if (unknown.length) throw new Error(`The ${resolution} schema has new columns requiring inspection: ${unknown.join(', ')}.`);
  const errors = [], warnings = [], invalidNumbers = [], records = [];
  const schema = headers.map((name) => ({ name, inferredType: name === dateField ? (resolution === 'monthly' ? 'calendar month (YYYY-MM)' : 'calendar date (YYYY-MM-DD)') : QA_FIELDS.includes(name) ? 'JSON object of category:integer-count' : null, nullCount: 0, invalidCount: 0 }));
  const byName = Object.fromEntries(schema.map((column) => [column.name, column]));
  const error = (record, field, message) => errors.push({ record, field, message });
  for (const [index, values] of rows.entries()) {
    const recordNumber = index + 2;
    const record = {};
    for (const [columnIndex, column] of headers.entries()) {
      const raw = values[columnIndex];
      if (raw.trim() === '' || (allowMeasurementNaN && MEASUREMENTS.includes(column) && /^nan$/i.test(raw.trim()))) { byName[column].nullCount += 1; record[column] = null; continue; }
      if (column === dateField) {
        record[column] = raw;
        if (!isDateKey(raw, resolution)) { byName[column].invalidCount += 1; error(recordNumber, column, 'Invalid calendar date/month.'); }
      } else if (QA_FIELDS.includes(column)) {
        try {
          const distribution = JSON.parse(raw);
          if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)
              || Object.entries(distribution).some(([key, count]) => !/^\d+$/.test(key) || !Number.isSafeInteger(count) || count < 0)) throw new Error('Invalid histogram.');
          record[column] = distribution;
        } catch { byName[column].invalidCount += 1; record[column] = null; error(recordNumber, column, 'Expected a JSON object with non-negative integer category counts.'); }
      } else {
        try { record[column] = numericValue(raw); }
        catch {
          byName[column].invalidCount += 1; record[column] = null;
          invalidNumbers.push({ record: recordNumber, field: column, raw });
          error(recordNumber, column, 'Non-numeric or non-finite numeric value.');
        }
      }
    }
    if (record[dateField] === null) error(recordNumber, dateField, 'Date/month cannot be null.');
    const totalField = resolution === 'monthly' ? 'total_pixel_observations' : 'total_pixel_count';
    const countFields = headers.filter((field) => field.endsWith('_count') || field === 'total_pixel_observations');
    for (const field of countFields) if (!Number.isSafeInteger(record[field]) || record[field] < 0) error(recordNumber, field, 'Count must be a non-negative safe integer.');
    for (const prefix of ['ndvi', 'evi']) {
      const count = record[`${prefix}_valid_pixel_count`];
      const total = record[totalField];
      if (count > total) error(recordNumber, `${prefix}_valid_pixel_count`, 'Valid pixels exceed the total.');
      const percentage = record[`${prefix}_valid_pixel_percentage`];
      if (percentage !== null && (percentage < 0 || percentage > 100)) error(recordNumber, `${prefix}_valid_pixel_percentage`, 'Percentage must lie in [0, 100].');
      if (total > 0 && !close(percentage, 100 * count / total)) error(recordNumber, `${prefix}_valid_pixel_percentage`, 'Percentage does not match valid/total pixel counts.');
      for (const statistic of ['mean', 'median', 'std']) {
        const field = `${prefix}_${statistic}`;
        if (count === 0 && record[field] !== null) error(recordNumber, field, 'Zero valid pixels must have a null statistic, not zero or an estimate.');
        if (count > 0 && record[field] === null) error(recordNumber, field, 'Positive valid-pixel count has a missing statistic.');
      }
      if (record[`${prefix}_std`] !== null && record[`${prefix}_std`] < 0) error(recordNumber, `${prefix}_std`, 'Standard deviation cannot be negative.');
    }
    if (resolution === '16day') {
      for (const field of QA_FIELDS) if (record[field] === null) error(recordNumber, field, 'QA distributions must be present JSON objects, including {} for no retained pixels.');
      if (record.base_valid_pixel_count > record.total_pixel_count || record.quality_valid_pixel_count > record.base_valid_pixel_count) error(recordNumber, 'quality_valid_pixel_count', 'Quality/base/total pixel counts are inconsistent.');
      for (const prefix of ['ndvi', 'evi']) if (record[`${prefix}_valid_pixel_count`] > record.quality_valid_pixel_count) error(recordNumber, `${prefix}_valid_pixel_count`, 'Variable-valid count exceeds quality-valid count.');
      const before = record[QA_FIELDS[0]], after = record[QA_FIELDS[1]];
      if (before && statistics(Object.values(before)).sum !== record.base_valid_pixel_count) error(recordNumber, QA_FIELDS[0], 'Before-filter histogram does not sum to base-valid count.');
      if (after && statistics(Object.values(after)).sum !== record.quality_valid_pixel_count) error(recordNumber, QA_FIELDS[1], 'After-filter histogram does not sum to quality-valid count.');
      if (before && after && Object.entries(after).some(([key, count]) => count > (before[key] ?? 0))) error(recordNumber, QA_FIELDS[1], 'After-filter category count exceeds before-filter count.');
    }
    records.push(record);
  }
  for (const column of schema) {
    if (!column.inferredType) {
      const numbers = records.map((record) => record[column.name]).filter((value) => typeof value === 'number');
      column.inferredType = numbers.length ? (numbers.every(Number.isSafeInteger) ? 'integer' : 'finite decimal number') : 'unknown (no valid numeric values)';
      column.statistics = statistics(numbers);
    }
  }
  const dates = records.map((record) => record[dateField]).filter((date) => typeof date === 'string' && isDateKey(date, resolution));
  const sorted = [...dates].sort();
  const duplicateDates = duplicates(dates);
  if (duplicateDates.length) errors.push({ field: dateField, message: 'Duplicate dates/months exist.', duplicates: duplicateDates });
  const orderViolations = dates.flatMap((date, index) => index && date <= dates[index - 1] ? [{ previous: dates[index - 1], current: date }] : []);
  if (orderViolations.length) errors.push({ field: dateField, message: 'Dates/months are not strictly ascending.', details: orderViolations });
  if (records.length !== EXPECTED_ROWS[resolution]) errors.push({ message: `Expected ${EXPECTED_ROWS[resolution]} rows; found ${records.length}. No rows have been added or removed.` });
  const noData = records.filter((record) => record.ndvi_valid_pixel_count === 0 && record.evi_valid_pixel_count === 0).map((record) => record[dateField]);
  const partialData = records.filter((record) => (record.ndvi_valid_pixel_count === 0) !== (record.evi_valid_pixel_count === 0)).map((record) => record[dateField]);
  const qaDistributions = Object.fromEntries(QA_FIELDS.filter((field) => headers.includes(field)).map((field) => {
    const aggregate = {};
    for (const record of records) for (const [key, value] of Object.entries(record[field] ?? {})) aggregate[key] = (aggregate[key] ?? 0) + value;
    return [field, aggregate];
  }));
  const gaps = resolution === '16day' ? dates.slice(1).map((date, index) => ({ previous: dates[index], current: date, days: (Date.parse(date) - Date.parse(dates[index])) / 86400000 })) : [];
  const irregularWithinYearGaps = gaps.filter((gap) => gap.previous.slice(0, 4) === gap.current.slice(0, 4) && gap.days !== 16);
  const offCadenceDates = resolution === '16day' ? dates.filter((date) => ((Date.parse(date) - Date.parse(`${date.slice(0, 4)}-01-01`)) / 86400000) % 16 !== 0) : [];
  const missingCadenceDates = [];
  if (resolution === '16day' && sorted.length) {
    const present = new Set(dates);
    for (let year = Number(sorted[0].slice(0, 4)); year <= Number(sorted.at(-1).slice(0, 4)); year += 1) {
      for (let epoch = Date.parse(`${year}-01-01`); epoch < Date.parse(`${year + 1}-01-01`); epoch += 16 * 86400000) {
        const date = new Date(epoch).toISOString().slice(0, 10);
        if (date >= sorted[0] && date <= sorted.at(-1) && !present.has(date)) missingCadenceDates.push(date);
      }
    }
  }
  if (offCadenceDates.length || missingCadenceDates.length) errors.push({ field: dateField, message: 'Dates do not match a January-1-anchored 16-day calendar within the actual source range.', offCadenceDates, missingCadenceDates });
  const zeroQualityDates = resolution === '16day' ? records.filter((record) => record.quality_valid_pixel_count === 0).map((record) => record.date) : [];
  return {
    resolution, headers, rowCount: records.length, expectedRowCount: EXPECTED_ROWS[resolution],
    schema, records, firstDate: sorted[0] ?? null, lastDate: sorted.at(-1) ?? null,
    duplicateDates, duplicateRecords: duplicates(rows.map((row) => JSON.stringify(row))),
    orderViolations, invalidNumbers, noData, partialData, zeroQualityDates,
    zeroQualityEqualsNoData: resolution === '16day' ? JSON.stringify(zeroQualityDates) === JSON.stringify(noData) : null,
    ndviEviCountMismatches: records.filter((record) => record.ndvi_valid_pixel_count !== record.evi_valid_pixel_count).map((record) => record[dateField]),
    variableQualityCountMismatches: resolution === '16day' ? records.filter((record) => record.ndvi_valid_pixel_count !== record.quality_valid_pixel_count || record.evi_valid_pixel_count !== record.quality_valid_pixel_count).map((record) => record.date) : [],
    yearCounts: histogram(dates.map((date) => date.slice(0, 4))),
    noDataMonthDistribution: histogram(noData.map((date) => date?.slice(5, 7))),
    measurementStatistics: Object.fromEntries(MEASUREMENTS.map((field) => [field, statistics(records.map((record) => record[field]))])),
    qaDistributions, gapDaysDistribution: histogram(gaps.map((gap) => gap.days)), irregularWithinYearGaps, offCadenceDates, missingCadenceDates,
    errors, warnings, samples: records.slice(0, 3),
  };
}

export function weightedMean(records, prefix) {
  const valid = records.filter((record) => record[`${prefix}_valid_pixel_count`] > 0 && typeof record[`${prefix}_mean`] === 'number' && Number.isFinite(record[`${prefix}_mean`]));
  const weight = valid.reduce((sum, record) => sum + record[`${prefix}_valid_pixel_count`], 0);
  return weight ? valid.reduce((sum, record) => sum + record[`${prefix}_mean`] * record[`${prefix}_valid_pixel_count`], 0) / weight : null;
}

export function reconcileFiles(composite, monthly, { verifyPooledStd = true } = {}) {
  const groups = new Map();
  for (const record of composite.records) {
    if (!isDateKey(record.date ?? '', '16day')) continue;
    const month = record.date.slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(record);
  }
  const checks = [], errors = [];
  for (const row of monthly.records) {
    const records = groups.get(row.month) ?? [];
    const check = { month: row.month, sourceObservationCount: records.length, monthlyObservationCount: row.observation_count, availableCompositeCount: records.filter((record) => record.ndvi_valid_pixel_count > 0 && record.evi_valid_pixel_count > 0).length, checks: {}, meanDifferences: {}, pooledStdDifferences: {} };
    const compare = (field, expected) => {
      check.checks[field] = close(row[field], expected);
      if (!check.checks[field]) errors.push({ month: row.month, field, source: row[field], recalculated: expected });
    };
    compare('observation_count', records.length);
    compare('total_pixel_observations', records.reduce((sum, record) => sum + (record.total_pixel_count ?? 0), 0));
    for (const prefix of ['ndvi', 'evi']) {
      compare(`${prefix}_valid_pixel_count`, records.reduce((sum, record) => sum + (record[`${prefix}_valid_pixel_count`] ?? 0), 0));
      const expected = weightedMean(records, prefix);
      compare(`${prefix}_mean`, expected);
      check.meanDifferences[prefix] = expected === null || row[`${prefix}_mean`] === null ? null : Math.abs(expected - row[`${prefix}_mean`]);
      if (verifyPooledStd) {
        const available = records.filter((record) => record[`${prefix}_valid_pixel_count`] > 0 && record[`${prefix}_mean`] !== null && record[`${prefix}_std`] !== null);
        const weight = available.reduce((sum, record) => sum + record[`${prefix}_valid_pixel_count`], 0);
        const pooledStd = weight && expected !== null ? Math.sqrt(available.reduce((sum, record) => sum + record[`${prefix}_valid_pixel_count`] * (record[`${prefix}_std`] ** 2 + (record[`${prefix}_mean`] - expected) ** 2), 0) / weight) : null;
        compare(`${prefix}_std`, pooledStd);
        check.pooledStdDifferences[prefix] = pooledStd === null || row[`${prefix}_std`] === null ? null : Math.abs(pooledStd - row[`${prefix}_std`]);
      }
    }
    checks.push(check);
  }
  const monthlyKeys = new Set(monthly.records.map((row) => row.month));
  const missingMonthlyRecords = [...groups.keys()].filter((month) => !monthlyKeys.has(month));
  const monthlyRecordsWithoutComposites = [...monthlyKeys].filter((month) => !groups.has(month));
  if (missingMonthlyRecords.length || monthlyRecordsWithoutComposites.length) errors.push({ message: 'Month keys differ between files.', missingMonthlyRecords, monthlyRecordsWithoutComposites });
  const emptyCalendarMonths = [];
  if (composite.firstDate && composite.lastDate) {
    const end = composite.lastDate.slice(0, 7);
    let month = composite.firstDate.slice(0, 7);
    while (month <= end) {
      if (!monthlyKeys.has(month)) emptyCalendarMonths.push(month);
      const [year, number] = month.split('-').map(Number);
      month = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, '0')}`;
    }
  }
  if (emptyCalendarMonths.length) errors.push({ message: 'Calendar months are absent.', months: emptyCalendarMonths });
  return {
    monthCount: checks.length, observationCountSum: monthly.records.reduce((sum, row) => sum + (row.observation_count ?? 0), 0),
    monthlyObservationCountDistribution: histogram(monthly.records.map((row) => row.observation_count)),
    missingMonthlyRecords, monthlyRecordsWithoutComposites, emptyCalendarMonths,
    maxAbsoluteMeanDifference: Object.fromEntries(['ndvi', 'evi'].map((prefix) => [prefix, statistics(checks.map((check) => check.meanDifferences[prefix])).max])),
    maxAbsolutePooledStdDifference: Object.fromEntries(['ndvi', 'evi'].map((prefix) => [prefix, statistics(checks.map((check) => check.pooledStdDifferences[prefix])).max])),
    meanMatches: Object.fromEntries(['ndvi', 'evi'].map((prefix) => [prefix, {
      nonNull: checks.filter((check, index) => check.checks[`${prefix}_mean`] && monthly.records[index][`${prefix}_mean`] !== null).length,
      null: checks.filter((check, index) => check.checks[`${prefix}_mean`] && monthly.records[index][`${prefix}_mean`] === null).length,
      mismatched: checks.filter((check) => !check.checks[`${prefix}_mean`]).length,
    }])),
    zeroDataMonths: monthly.noData,
    expectedMissingMonthsMatch: JSON.stringify(monthly.noData) === JSON.stringify(['2019-02', '2021-01']),
    expectedMissingObservationsMatch: composite.zeroQualityDates.length === 18,
    comparisons: checks, errors,
  };
}

async function readSource(dataRoot, resolution, options) {
  const file = path.join(dataRoot, SOURCES[resolution]);
  try {
    await access(file, constants.R_OK);
    const details = await stat(file);
    if (!details.isFile()) throw new Error('Not a regular file.');
    if (details.size > 20 * 1024 * 1024) throw new Error('Summary CSV exceeds the audit limit of 20 MiB.');
    const bytes = await readFile(file);
    const text = bytes.toString('utf8');
    return { path: file, sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), modifiedAt: details.mtime.toISOString(), rawPreview: text.split(/\r\n|\r|\n/).slice(0, 4).join('\n'), audit: auditCsv(text, resolution, options) };
  } catch (error) { throw new Error(`Cannot audit ${file}: ${error.message}`); }
}

export async function auditSources(dataRoot = process.env.TERRAPULSE_DATA_ROOT, options = {}) {
  if (!dataRoot) throw new Error('TERRAPULSE_DATA_ROOT is unavailable. Set it explicitly; no alternative path will be guessed.');
  if (!path.isAbsolute(dataRoot)) throw new Error('TERRAPULSE_DATA_ROOT must be an absolute directory path.');
  const [composite, monthly] = await Promise.all([readSource(dataRoot, '16day', options), readSource(dataRoot, 'monthly', options)]);
  const reconciliation = reconcileFiles(composite.audit, monthly.audit, options);
  const integrityErrors = [];
  if (!reconciliation.expectedMissingObservationsMatch) integrityErrors.push('The source does not match the reported 18 zero-quality-valid observations.');
  if (!reconciliation.expectedMissingMonthsMatch) integrityErrors.push('The no-data months do not match the reported February 2019 and January 2021.');
  for (const source of [composite, monthly]) {
    const after = await readFile(source.path);
    if (createHash('sha256').update(after).digest('hex') !== source.sha256) integrityErrors.push(`Source bytes changed during audit: ${source.path}`);
  }
  return {
    generatedAt: new Date().toISOString(), root: dataRoot, composite, monthly, reconciliation,
    numericTolerance: TOLERANCE, integrityErrors,
    passed: ![...composite.audit.errors, ...monthly.audit.errors, ...reconciliation.errors, ...integrityErrors].length,
  };
}

const cell = (value) => value === null || value === undefined ? 'null' : String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
].join('\n');

export function renderAuditReport(result) {
  const lines = [
    '# MODIS backend source audit — read-only AOI summaries', '',
    `Generated (UTC): ${result.generatedAt}.`, '',
    `**Dry-run result: ${result.passed ? 'PASS' : 'FAIL'}.** Both files were read through \`process.env.TERRAPULSE_DATA_ROOT\`. Source checksums were checked again after parsing. No database connection, asset registration, lifecycle update, ingestion, scaling, QA filtering, source-file write, vegetation collection, or vegetation API is performed by this script.`, '',
    '**Spatial limitation: these files summarize a bounding-box AOI. They are not an exact Story County polygon mask and must not be represented as county-only statistics.** The CSVs do not contain the AOI geometry or bounding coordinates, so its exact footprint cannot be independently reconstructed from these two files.', '',
    '## Source identity and scope', '',
    table(['Resolution', 'Actual source path', 'Size (bytes)', 'SHA-256'], ['composite', 'monthly'].map((key) => {
      const source = result[key]; return [source.audit.resolution, source.path, source.sizeBytes, source.sha256];
    })), '',
    'The root was supplied explicitly to the audit process. There is no hardcoded/default data root in the audit code. Mahdi\'s Linux path is not used. The old county-masked filenames and mask-report assumptions are superseded by the user-provided AOI files for this phase. No separate processing report was supplied or treated as audited evidence.', '',
    'Product/processing provenance supplied by the user: NASA MOD13Q1.061, 250 m nominal spatial resolution, native 16-day composites; NDVI/EVI were already scale-decoded (dimensionless indices). Pixel Reliability = 0 and MODLAND QA = 0, with MODLAND bits 0–1, were applied upstream. **No 0.0001 scaling or QA filters were applied during this audit.** Units, scaling history, raw QA flags, and exact upstream code are not independently provable from the CSVs: neither a units/scale column nor Pixel Reliability/MODLAND QA flag columns is present. The available VI usefulness histograms are a different QA diagnostic.', '',
    'Numeric summaries below preserve the existing decoded values. Blank cells become null only in audit memory; they are never converted to zero. The per-file mean is the unweighted arithmetic mean of non-null row means, not a pixel-weighted spatial estimate. Minima/maxima below describe the exported summary columns, not raw pixel extrema. Null-only averages/minima/maxima remain null. The CSV schemas contain no coordinates, CRS, or AOI geometry; exact spatial verification cannot be inferred from their pixel totals.', '',
  ];
  for (const key of ['composite', 'monthly']) {
    const source = result[key], audit = source.audit;
    lines.push(`## ${audit.resolution} file`, '',
      `Rows: **${audit.rowCount}** (expected ${audit.expectedRowCount}); first/last ${audit.resolution === 'monthly' ? 'months' : 'dates'}: **${audit.firstDate} — ${audit.lastDate}**. Date/month nulls: ${audit.schema.find((column) => column.name === (audit.resolution === 'monthly' ? 'month' : 'date')).nullCount}. Duplicate date/month keys: ${audit.duplicateDates.length}; duplicate complete records: ${audit.duplicateRecords.length}; ordering violations: ${audit.orderViolations.length}.`, '',
      'Exact headers in source order, observed non-null data types, null counts, and invalid counts:', '',
      table(['Column', 'Observed type', 'Nulls', 'Invalid'], audit.schema.map((column) => [column.name, column.inferredType, column.nullCount, column.invalidCount])), '',
      'Numeric column statistics (nulls excluded; counts and percentages retain their source meanings):', '',
      table(['Column', 'Non-null count', 'Minimum', 'Maximum', 'Arithmetic mean', 'Sum'], audit.schema.filter((column) => column.statistics).map((column) => {
        const stats = column.statistics; return [column.name, stats.count, stats.min, stats.max, stats.mean, stats.sum];
      })), '',
      `Invalid numeric values: ${audit.invalidNumbers.length}. Per-variable zero-data mismatches: ${audit.partialData.length}. NDVI/EVI valid-pixel count mismatches: ${audit.ndviEviCountMismatches.length}.`, '',
      `Records per year: \`${JSON.stringify(audit.yearCounts)}\`.`, '',
      'Actual source sample: first three records plus the original header (no source-file modification):', '', '```csv', source.rawPreview, '```', '',
      `Validation errors (${audit.errors.length}):`, '', '```json', JSON.stringify(audit.errors, null, 2), '```', '',
      `Warnings (${audit.warnings.length}): \`${JSON.stringify(audit.warnings)}\`.`, '');
    if (audit.resolution === '16day') lines.push(
      `Zero-quality-valid observations: **${audit.zeroQualityDates.length}**. Zero-quality dates match all-null NDVI/EVI dates: **${audit.zeroQualityEqualsNoData}**. Variable-valid vs quality-valid count mismatches: ${audit.variableQualityCountMismatches.length}.`, '',
      `No-data date list: ${audit.noData.join(', ')}.`, '',
      `No-data calendar-month distribution: \`${JSON.stringify(audit.noDataMonthDistribution)}\`. December/January/February are calendar winter here; the cause of failed quality criteria is **not established**.`, '',
      `Consecutive gap distribution (days): \`${JSON.stringify(audit.gapDaysDistribution)}\`. Within-year gaps other than 16 days: ${audit.irregularWithinYearGaps.length}. Off-calendar dates: ${audit.offCadenceDates.length}; absent January-1-anchored composite timestamps inside the actual date range: ${audit.missingCadenceDates.length}. The 13/14-day gaps at year transitions reflect the January-1 reset and leap-year calendar, not absent composites. UTC is used only for deterministic calendar arithmetic; the CSV date keys have no timezone field.`, '',
      'Aggregated VI usefulness distributions. Counts are pixel-observations across dates, not unique physical pixels:', '',
      table(['Category', 'Before filter', 'After filter'], [...new Set(QA_FIELDS.flatMap((field) => Object.keys(audit.qaDistributions[field] ?? {})))].sort((a, b) => Number(a) - Number(b)).map((code) => [code, audit.qaDistributions[QA_FIELDS[0]][code] ?? 0, audit.qaDistributions[QA_FIELDS[1]][code] ?? 0])), '',
      `Exported QA histogram sum/subset/format check errors: ${audit.errors.filter((error) => QA_FIELDS.includes(error.field)).length}. Zero errors means before-filter sums match base-valid counts, after-filter sums match quality-valid counts, and retained category counts do not exceed original counts. These checks do not reapply or independently verify the upstream raw-flag selection.`, '');
  }
  const cross = result.reconciliation;
  lines.push('## Cross-file reconciliation', '',
    `Monthly rows reconciled: **${cross.monthCount}**. Monthly observation_count sum: **${cross.observationCountSum}**. Observation-count distribution: \`${JSON.stringify(cross.monthlyObservationCountDistribution)}\`.`, '',
    `Absent monthly records for composite month keys: \`${JSON.stringify(cross.missingMonthlyRecords)}\`; monthly records without composite dates: \`${JSON.stringify(cross.monthlyRecordsWithoutComposites)}\`; missing calendar-month rows: \`${JSON.stringify(cross.emptyCalendarMonths)}\`.`, '',
    `Monthly rows with no valid data: **${cross.zeroDataMonths.join(', ') || 'none'}**. These records exist; they are not absent rows. Their actual fields are shown below; no missing month was interpolated or filled.`, '',
    '```json', JSON.stringify(result.monthly.audit.records.filter((record) => cross.zeroDataMonths.includes(record.month)), null, 2), '```', '',
    `Monthly count/total/valid-count reconciliation: ${cross.comparisons.filter((check) => ['observation_count', 'total_pixel_observations', 'ndvi_valid_pixel_count', 'evi_valid_pixel_count'].every((field) => check.checks[field])).length}/${cross.monthCount} rows match. Assignment uses composite date calendar-month keys; no interval/day-overlap weights are invented. These monthly counts count repeated pixel-observations, not unique AOI pixels or county area.`, '',
    'The independent monthly mean check is sum(composite mean × its valid-pixel count) / sum(valid-pixel counts), separately for NDVI and EVI. Months with zero total weight remain null. Absolute tolerance: ' + result.numericTolerance + '.', '',
    `Weighted mean match counts: \`${JSON.stringify(cross.meanMatches)}\`.`, '',
    table(['Variable', 'Maximum absolute weighted-mean difference', 'Maximum absolute pooled-population-std difference'], ['ndvi', 'evi'].map((prefix) => [prefix.toUpperCase(), cross.maxAbsoluteMeanDifference[prefix], cross.maxAbsolutePooledStdDifference[prefix]])), '',
    `Pooled-population-standard-deviation checks passed for ${cross.comparisons.filter((check) => check.checks.ndvi_std && check.checks.evi_std).length}/${cross.monthCount} rows. This check pools composite population variances and between-composite mean differences, weighted by valid-pixel counts. Matching is consistency evidence for a population/pixel-observation aggregation, not proof of the original code or ddof setting. Monthly medians cannot be independently reconstructed from composite medians/counts; original pixel values are not present and were not requested or reprocessed.`, '',
    'Complete per-month checks (counts, totals, valid counts, weighted means, and pooled population standard deviations):', '',
    table(['Month', 'Composite dates', 'Monthly observation_count', 'Composites with data', 'All checks pass', 'NDVI mean abs. diff.', 'EVI mean abs. diff.'], cross.comparisons.map((check) => [check.month, check.sourceObservationCount, check.monthlyObservationCount, check.availableCompositeCount, Object.values(check.checks).every(Boolean), check.meanDifferences.ndvi, check.meanDifferences.evi])), '',
    `Cross-file discrepancies (${cross.errors.length}):`, '', '```json', JSON.stringify(cross.errors, null, 2), '```', '',
    '## Integrity findings and dry-run status', '', '```json', JSON.stringify({ passed: result.passed, numericTolerance: result.numericTolerance, integrityErrors: result.integrityErrors }, null, 2), '```', '',
    'No counts were forced, no duplicate was dropped, and no record/value was created, replaced, rescaled, or interpolated. Differences at floating-point rounding scale are reported above rather than modifying either CSV. Expected 207/108 row counts and 18 zero-quality observations are checks, not substitutes for measured counts.', '',
    'Limitations: bounding-box AOI only; no exact county polygon statistics or raster/map rendering. No raw QA verification, upstream cause attribution for winter gaps, reconstructed pixel values, independent median verification, or observation-time timezone inference. Monthly data aggregate the existing composites; they are not an independent satellite product.', '',
    '## Reproduction and approval boundary', '',
    'Set TERRAPULSE_DATA_ROOT explicitly in the invoking environment, then run `npm run audit` to print this audit. Run `node scripts/auditModisSource.js --report` to also replace only this report in the backend. Missing/unreadable input or absent/relative data root fails; no alternative location is searched. The script imports only Node standard-library modules and contains no MongoDB code.', '',
    'MongoDB ingestion, DatasetAsset registration, lifecycle promotion, vegetation collections, and vegetation APIs remain blocked pending separate user approval. Regression test results are documented in the README; source dry-run success is not a database integration result.', '');
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--report')) {
    console.error('Usage: node scripts/auditModisSource.js [--report]');
    process.exitCode = 1;
    return;
  }
  try {
    const result = await auditSources();
    const markdown = renderAuditReport(result);
    console.log(markdown);
    if (args.includes('--report')) {
      await mkdir(path.dirname(REPORT_PATH), { recursive: true });
      await writeFile(REPORT_PATH, markdown, 'utf8');
      console.log(`Audit report written: ${REPORT_PATH}`);
    }
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`MODIS source audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
