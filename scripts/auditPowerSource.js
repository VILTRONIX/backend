import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, numericValue, isDateKey, statistics } from './auditModisSource.js';

// Preliminary source inspection only. No environment loading, database code, or write API.
export const POWER_SNAPSHOT = Object.freeze({
  relativePath: 'processed/power/power_monthly_by_location.csv', sizeBytes: 79518,
  sha256: '59e1e97a477f6d32767f5016da8b02dbd20b45f37ad65e33e65468f35aeff097',
  rowCount: 432, locationIds: ['DG001', 'DG002', 'DG003', 'DG004'], start: '2017-01', end: '2025-12',
});
export const POWER_HEADERS = Object.freeze([
  'location_id', 'latitude', 'longitude', 'year', 'month', 'month_start', 'month_end',
  'days_expected', 'days_present', 'complete', 'T2M_mean', 'T2M_MAX_mean', 'T2M_MIN_mean',
  'PRECTOTCORR_total', 'PRECTOTCORR_daily_mean', 'ALLSKY_SFC_SW_DWN_total',
  'ALLSKY_SFC_SW_DWN_daily_mean', 'RH2M_mean',
]);
export const POWER_MEASUREMENTS = POWER_HEADERS.slice(10);
const NUMERIC = ['latitude', 'longitude', 'year', 'month', 'days_expected', 'days_present', ...POWER_MEASUREMENTS];
const INTEGER = ['year', 'month', 'days_expected', 'days_present'];
const MISSING = /^(?:nan|null|na|n\/a)$/i;
const TOLERANCE = 1e-9; // Arithmetic reconciliation tolerance in unchanged source numeric units.
const duplicates = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([key, count]) => ({ key, count }));
};
function monthsBetween(start, end) {
  const keys = [];
  for (let year = Number(start.slice(0, 4)); year <= Number(end.slice(0, 4)); year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (key >= start && key <= end) keys.push(key);
    }
  }
  return keys;
}

export function auditPowerCsv(text) {
  const { headers, rows } = parseCsv(text);
  const errors = [], missingValues = [], invalidValues = [], completeTokens = {};
  const issue = (record, column, message) => errors.push({ record, column, message });
  const headerMatch = JSON.stringify(headers) === JSON.stringify(POWER_HEADERS);
  if (!headerMatch) issue(null, 'headers', 'Exact ordered schema differs from this preliminary snapshot.');
  const records = rows.map((values, index) => {
    const record = {};
    for (const [columnIndex, column] of headers.entries()) {
      const raw = values[columnIndex], trimmed = raw.trim();
      if (column === 'complete') completeTokens[raw] = (completeTokens[raw] ?? 0) + 1;
      if (!trimmed || MISSING.test(trimmed)) {
        record[column] = null;
        missingValues.push({ record: index + 2, column, token: raw });
      } else try {
        if (NUMERIC.includes(column)) record[column] = numericValue(raw);
        else if (column === 'complete') {
          if (!['True', 'False'].includes(raw)) throw new Error('Expected the source Boolean token True or False.');
          record[column] = raw === 'True';
        } else record[column] = raw;
      } catch {
        // Invalid values are counted separately from genuinely missing source tokens.
        record[column] = null;
        invalidValues.push({ record: index + 2, column, token: raw });
        issue(index + 2, column, 'Invalid source value/type.');
      }
    }
    return record;
  });
  for (const [index, row] of records.entries()) {
    const number = index + 2;
    for (const field of ['location_id', 'latitude', 'longitude', ...INTEGER, 'complete', 'month_start', 'month_end']) {
      if (row[field] == null) issue(number, field, 'Required identity/calendar/completeness value is missing or invalid.');
    }
    for (const field of INTEGER) if (row[field] !== null && !Number.isSafeInteger(row[field])) issue(number, field, 'Expected a safe integer.');
    if (!(row.latitude >= -90 && row.latitude <= 90) || !(row.longitude >= -180 && row.longitude <= 180)) issue(number, 'coordinates', 'Latitude/longitude numeric range failed.');
    const period = `${row.year}-${String(row.month).padStart(2, '0')}`;
    if (!isDateKey(period, 'monthly')) { issue(number, 'year/month', 'Invalid calendar year/month.'); continue; }
    const start = `${period}-01`;
    const lastDay = new Date(`${start}T00:00:00Z`);
    lastDay.setUTCMonth(lastDay.getUTCMonth() + 1);
    lastDay.setUTCDate(0);
    const expectedDays = lastDay.getUTCDate();
    if (row.month_start !== start || row.month_end !== lastDay.toISOString().slice(0, 10)) issue(number, 'month_start/month_end', 'Bounds disagree with the original year/month.');
    if (row.days_expected !== expectedDays) issue(number, 'days_expected', 'Expected days disagree with the calendar, including leap years.');
    if (!(row.days_present >= 0 && row.days_present <= expectedDays)) issue(number, 'days_present', 'Present days fall outside calendar bounds.');
    if (row.complete !== (row.days_expected === row.days_present)) issue(number, 'complete', 'Completeness flag disagrees with declared day counts.');
  }
  const locationIds = [...new Set(records.map((row) => row.location_id))].sort();
  const duplicateKeys = duplicates(records.map((row) => `${row.location_id}:${row.year}-${String(row.month).padStart(2, '0')}`));
  if (duplicateKeys.length) issue(null, 'location/month', 'Duplicate location-month combinations exist.');
  if (records.length !== POWER_SNAPSHOT.rowCount) issue(null, 'rowCount', 'Row count differs from the preliminary expectation of 432.');
  if (JSON.stringify(locationIds) !== JSON.stringify(POWER_SNAPSHOT.locationIds)) issue(null, 'location_id', 'Location inventory differs from the four expected IDs.');
  const locations = locationIds.map((id) => {
    const selected = records.filter((row) => row.location_id === id);
    const periods = selected.map((row) => `${row.year}-${String(row.month).padStart(2, '0')}`);
    const sorted = [...periods].sort();
    const coordinates = [...new Map(selected.map((row) => [JSON.stringify([row.longitude, row.latitude]), { latitude: row.latitude, longitude: row.longitude }])).values()];
    const missingMonths = monthsBetween(POWER_SNAPSHOT.start, POWER_SNAPSHOT.end).filter((key) => !periods.includes(key));
    const unexpectedMonths = periods.filter((key) => key < POWER_SNAPSHOT.start || key > POWER_SNAPSHOT.end);
    if (coordinates.length !== 1 || selected.length !== 108 || missingMonths.length || unexpectedMonths.length) issue(null, id, 'Location coordinates/count/expected monthly coverage differ.');
    return {
      locationId: id, coordinates, rowCount: selected.length, firstMonth: sorted[0] ?? null, lastMonth: sorted.at(-1) ?? null,
      uniqueMonths: new Set(periods).size, ascending: periods.every((key, index) => index === 0 || key > periods[index - 1]),
      missingMonths, unexpectedMonths, completeCount: selected.filter((row) => row.complete === true).length,
      incompleteCount: selected.filter((row) => row.complete === false).length,
      daysExpected: selected.reduce((sum, row) => sum + (row.days_expected ?? 0), 0),
      daysPresent: selected.reduce((sum, row) => sum + (row.days_present ?? 0), 0),
    };
  });
  const reconciliation = ['PRECTOTCORR', 'ALLSKY_SFC_SW_DWN'].map((prefix) => {
    let tested = 0, maximumDifference = null, maximumExpectedDaysDifference = null;
    const mismatches = [];
    for (const [index, row] of records.entries()) {
      const total = row[`${prefix}_total`], mean = row[`${prefix}_daily_mean`];
      if (![total, mean, row.days_present, row.days_expected].every((value) => typeof value === 'number' && Number.isFinite(value))) continue;
      tested += 1;
      const difference = Math.abs(total - mean * row.days_present);
      maximumDifference = Math.max(maximumDifference ?? 0, difference);
      maximumExpectedDaysDifference = Math.max(maximumExpectedDaysDifference ?? 0, Math.abs(total - mean * row.days_expected));
      if (difference > TOLERANCE) mismatches.push({ record: index + 2, locationId: row.location_id, month: row.month_start?.slice(0, 7), difference });
    }
    if (mismatches.length) issue(null, prefix, 'Monthly total differs from daily mean times declared present days.');
    return { variable: prefix, tested, skipped: records.length - tested, tolerance: TOLERANCE, maximumDifference, maximumExpectedDaysDifference, mismatches };
  });
  const schema = headers.map((column) => {
    const values = records.map((row) => row[column]);
    return {
      name: column, type: column === 'complete' ? 'boolean (CSV True/False)' : NUMERIC.includes(column) ? INTEGER.includes(column) ? 'integer' : 'number' : column.startsWith('month_') ? 'YYYY-MM-DD calendar string' : 'string',
      observedTypes: [...new Set(values.filter((value) => value !== null).map((value) => typeof value))],
      nullCount: missingValues.filter((entry) => entry.column === column).length,
      invalidCount: invalidValues.filter((entry) => entry.column === column).length,
      ...(NUMERIC.includes(column) ? { statistics: statistics(values) } : {}),
    };
  });
  return {
    scope: 'preliminary_working_snapshot_not_import_approval', passed: errors.length === 0, headerMatch, headers, rowCount: records.length,
    locationIds, locations, duplicateKeys, completeTokens, missingValues, invalidValues, schema, reconciliation,
    dayCountMismatches: records.filter((row) => row.days_expected !== row.days_present).length,
    measurementSentinelCandidates: POWER_MEASUREMENTS.map((column) => ({ column, count: records.filter((row) => [-999, -9999].includes(row[column])).length })),
    missingVariables: ['WS10M'].filter((name) => !headers.some((column) => column === name || column.startsWith(`${name}_`))),
    unitVerificationStatus: 'unverified_no_snapshot_unit_metadata',
    coordinateCrsStatus: 'not_declared_in_csv', errors,
  };
}

export async function auditPowerSource(dataRoot = process.env.TERRAPULSE_DATA_ROOT) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new Error('Set TERRAPULSE_DATA_ROOT to an explicit absolute directory; no fallback is used.');
  const file = path.join(dataRoot, ...POWER_SNAPSHOT.relativePath.split('/'));
  await access(file, constants.R_OK);
  const info = await stat(file);
  if (!info.isFile() || info.size > 20 * 1024 * 1024) throw new Error('Expected a readable summary CSV no larger than 20 MiB.');
  const bytes = await readFile(file);
  const checksum = (value) => createHash('sha256').update(value).digest('hex');
  const sha256 = checksum(bytes);
  const audit = auditPowerCsv(bytes.toString('utf8'));
  const bytesAfter = await readFile(file);
  const fingerprintMatch = sha256 === POWER_SNAPSHOT.sha256 && bytes.length === POWER_SNAPSHOT.sizeBytes;
  const sourceUnchanged = checksum(bytesAfter) === sha256;
  return {
    file, sizeBytes: bytes.length, sha256, fingerprintMatch, sourceUnchanged,
    ...audit, passed: fingerprintMatch && sourceUnchanged && audit.passed,
    // Audit success describes this snapshot's structural checks, never ingestion/scientific approval.
    ingestionAuthorized: false, databaseAccessed: false,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 2) throw new Error('Usage: node scripts/auditPowerSource.js (read-only; no commit mode).');
    const result = await auditPowerSource();
    console.info(JSON.stringify(result, null, 2));
    if (!result.passed) process.exitCode = 1;
  } catch {
    console.error('POWER preliminary audit failed. Check the explicit data root, file readability, size limit, and CSV structure. No database access or source writes were attempted.');
    process.exitCode = 1;
  }
}
