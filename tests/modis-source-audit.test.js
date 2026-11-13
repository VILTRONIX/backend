import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCsv, numericValue, statistics, weightedMean, isDateKey, auditCsv, reconcileFiles, auditSources, renderAuditReport, SOURCES } from '../scripts/auditModisSource.js';

// Synthetic parser/statistics fixtures only. They are never imported or presented as NASA observations.
const compositeHeaders = ['date', 'ndvi_mean', 'ndvi_median', 'ndvi_std', 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_mean', 'evi_median', 'evi_std', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage', 'total_pixel_count', 'base_valid_pixel_count', 'quality_valid_pixel_count', 'vi_usefulness_distribution_before_filter', 'vi_usefulness_distribution_after_filter'];
const monthlyHeaders = ['month', 'observation_count', 'total_pixel_observations', 'ndvi_mean', 'ndvi_median', 'ndvi_std', 'ndvi_valid_pixel_count', 'ndvi_valid_pixel_percentage', 'evi_mean', 'evi_median', 'evi_std', 'evi_valid_pixel_count', 'evi_valid_pixel_percentage'];
function csv(headers, records) {
  const encode = (value) => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.join(','), ...records.map((record) => headers.map((field) => encode(record[field])).join(','))].join('\r\n') + '\r\n';
}
function composite(date = '2017-01-01', count = 2, mean = 0.2, std = 0.1) {
  const row = { date, total_pixel_count: 10, base_valid_pixel_count: 10, quality_valid_pixel_count: count,
    vi_usefulness_distribution_before_filter: { 1: 10 }, vi_usefulness_distribution_after_filter: count ? { 1: count } : {} };
  for (const prefix of ['ndvi', 'evi']) Object.assign(row, {
    [`${prefix}_mean`]: count ? mean : null, [`${prefix}_median`]: count ? mean : null, [`${prefix}_std`]: count ? std : null,
    [`${prefix}_valid_pixel_count`]: count, [`${prefix}_valid_pixel_percentage`]: count * 10,
  });
  return row;
}
function monthly(month = '2017-01', count = 3, mean = 0.4, std = Math.sqrt(0.1)) {
  const row = { month, observation_count: 2, total_pixel_observations: 20 };
  for (const prefix of ['ndvi', 'evi']) Object.assign(row, {
    [`${prefix}_mean`]: count ? mean : null, [`${prefix}_median`]: count ? mean : null, [`${prefix}_std`]: count ? std : null,
    [`${prefix}_valid_pixel_count`]: count, [`${prefix}_valid_pixel_percentage`]: count * 5,
  });
  return row;
}
const auditComposite = (rows) => auditCsv(csv(compositeHeaders, rows), '16day');
const auditMonthly = (rows) => auditCsv(csv(monthlyHeaders, rows), 'monthly');

test('CSV parser preserves escaped JSON quotes, CRLF, commas, BOM, and quoted newlines', () => {
  const parsed = parseCsv('\ufeffdate,qa,note\r\n2017-01-01,"{""1"": 2, ""2"": 3}","line one\nline two"\r\n');
  assert.deepEqual(parsed.headers, ['date', 'qa', 'note']);
  assert.deepEqual(parsed.rows, [['2017-01-01', '{"1": 2, "2": 3}', 'line one\nline two']]);
  assert.deepEqual(parseCsv('a,b\n"",\n').rows, [['', '']]);
});

test('CSV parser fails on malformed quoting, duplicate headers, empty input, and field-count drift', () => {
  for (const text of ['', 'a,a\n1,2\n', 'a,b\n1\n', 'a,b\n"open,2', 'a,b\n"closed"x,2', 'a,b\npre"quote,2']) assert.throws(() => parseCsv(text));
});

test('numeric decoding retains nulls and decoded values without rescaling', () => {
  assert.equal(numericValue(''), null);
  assert.equal(numericValue('   '), null);
  assert.equal(numericValue('0'), 0);
  assert.equal(numericValue('0.24394132511430436'), 0.24394132511430436);
  assert.equal(numericValue('1e-4'), 0.0001);
  for (const text of ['NaN', 'Infinity', '-Infinity', '1e999', '3,4', 'false', 'not-a-number']) assert.throws(() => numericValue(text));
});

test('date and month validation handles leap years and rejects impossible or padded dates', () => {
  assert.equal(isDateKey('2020-02-29', '16day'), true);
  assert.equal(isDateKey('2019-02-29', '16day'), false);
  assert.equal(isDateKey('2025-12-32', '16day'), false);
  assert.equal(isDateKey('2019-02', 'monthly'), true);
  for (const date of ['2019-13', '2019-00', ' 2019-02', '2019-02-01']) assert.equal(isDateKey(date, 'monthly'), false);
});

test('statistics and weighted means ignore nulls and return null when no valid values exist', () => {
  assert.deepEqual(statistics([null, undefined, NaN]), { count: 0, min: null, max: null, mean: null, sum: 0 });
  assert.equal(statistics([0, null, 2]).mean, 1);
  assert.equal(weightedMean([composite('2017-01-01', 2, 0.2), composite('2017-01-17', 1, 0.8)], 'ndvi'), 0.4000000000000001);
  assert.equal(weightedMean([composite('2017-01-01', 0)], 'ndvi'), null);
});

test('source audit preserves null measurements, QA distributions, actual row counts, and original dates', () => {
  const source = auditComposite([composite(), composite('2017-01-17', 0)]);
  assert.equal(source.rowCount, 2);
  assert.ok(source.errors.some((error) => error.message.includes('Expected 207 rows; found 2')));
  assert.equal(source.schema.find((column) => column.name === 'ndvi_mean').nullCount, 1);
  assert.equal(source.records[1].ndvi_mean, null);
  assert.deepEqual(source.records[0].vi_usefulness_distribution_after_filter, { 1: 2 });
  assert.deepEqual(source.zeroQualityDates, ['2017-01-17']);
  assert.equal(source.zeroQualityEqualsNoData, true);
  assert.equal(source.errors.filter((error) => error.record).length, 0);
});

test('invalid numbers are separate from genuine blank nulls and pixel consistency errors are reported', () => {
  const row = composite();
  row.ndvi_mean = 'NaN';
  row.ndvi_valid_pixel_percentage = 99;
  row.evi_std = -1;
  const source = auditComposite([row]);
  assert.equal(source.invalidNumbers.length, 1);
  const column = source.schema.find((entry) => entry.name === 'ndvi_mean');
  assert.equal(column.nullCount, 0);
  assert.equal(column.invalidCount, 1);
  assert.ok(source.errors.some((error) => error.field === 'ndvi_valid_pixel_percentage'));
  assert.ok(source.errors.some((error) => error.field === 'evi_std'));
});

test('QA histogram totals, subsets, format, and missing fields are checked', () => {
  const row = composite();
  row.vi_usefulness_distribution_before_filter = { 1: 1 };
  const source = auditComposite([row]);
  assert.ok(source.errors.some((error) => error.message.includes('does not sum to base-valid')));
  assert.ok(source.errors.some((error) => error.message.includes('exceeds before-filter')));
  row.vi_usefulness_distribution_before_filter = null;
  assert.ok(auditComposite([row]).errors.some((error) => error.message.includes('must be present JSON')));
  row.vi_usefulness_distribution_before_filter = { 1: -1 };
  assert.ok(auditComposite([row]).errors.some((error) => error.message.includes('non-negative integer category')));
});

test('duplicate records/dates, ordering, and composite calendar gaps are detected without dropping rows', () => {
  const row = composite();
  const duplicate = auditComposite([row, row]);
  assert.equal(duplicate.rowCount, 2);
  assert.equal(duplicate.duplicateDates[0].count, 2);
  assert.equal(duplicate.duplicateRecords[0].count, 2);
  assert.equal(duplicate.orderViolations.length, 1);
  const gap = auditComposite([row, composite('2017-02-02')]);
  assert.deepEqual(gap.missingCadenceDates, ['2017-01-17']);
  assert.deepEqual(auditComposite([composite('2017-01-02')]).offCadenceDates, ['2017-01-02']);
});

test('cross-file checks independently reconcile weighted means, pooled std, counts, and totals', () => {
  const source = auditComposite([composite(), composite('2017-01-17', 1, 0.8, 0.2)]);
  const result = reconcileFiles(source, auditMonthly([monthly()]));
  assert.deepEqual(result.errors, []);
  assert.equal(result.comparisons[0].availableCompositeCount, 2);
  assert.ok(result.maxAbsoluteMeanDifference.ndvi < 1e-15);
  assert.equal(result.meanMatches.ndvi.nonNull, 1);
  const bad = monthly();
  bad.ndvi_mean = 0.5;
  bad.observation_count = 3;
  const mismatch = reconcileFiles(source, auditMonthly([bad]));
  assert.ok(mismatch.errors.some((error) => error.field === 'ndvi_mean'));
  assert.ok(mismatch.errors.some((error) => error.field === 'observation_count'));
});

test('existing no-data monthly rows retain nulls and are distinct from absent month records', () => {
  const source = auditComposite([composite('2019-02-02', 0), composite('2019-02-18', 0)]);
  const monthlySource = auditMonthly([monthly('2019-02', 0)]);
  const result = reconcileFiles(source, monthlySource);
  assert.deepEqual(result.zeroDataMonths, ['2019-02']);
  assert.deepEqual(result.emptyCalendarMonths, []);
  assert.equal(result.meanMatches.ndvi.null, 1);
  assert.equal(monthlySource.records[0].ndvi_mean, null);
  const absent = reconcileFiles(source, auditMonthly([]));
  assert.deepEqual(absent.missingMonthlyRecords, ['2019-02']);
  assert.deepEqual(absent.emptyCalendarMonths, ['2019-02']);
});

test('source schema drift is rejected rather than guessing column names or types', () => {
  assert.throws(() => auditCsv('date,ndvi\n2017-01-01,0.5\n', '16day'), /missing required columns/);
  assert.throws(() => auditCsv(csv([...compositeHeaders, 'new_column'], [composite()]), '16day'), /new columns requiring inspection/);
});

test('missing or relative data root fails without trying another location', async () => {
  await assert.rejects(auditSources(''), /TERRAPULSE_DATA_ROOT is unavailable/);
  await assert.rejects(auditSources('relative-data'), /must be an absolute/);
});

test('complete file audit hashes source bytes and reports discrepancies without changing source files', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'terrapulse-modis-audit-test-'));
  const directory = path.join(root, 'processed', 'modis');
  await mkdir(directory, { recursive: true });
  const first = path.join(root, SOURCES['16day']), second = path.join(root, SOURCES.monthly);
  t.after(async () => {
    await unlink(first).catch(() => {}); await unlink(second).catch(() => {});
    await rmdir(directory); await rmdir(path.dirname(directory)); await rmdir(root);
  });
  await assert.rejects(auditSources(root), /Cannot audit/);
  const original = csv(compositeHeaders, [composite(), composite('2017-01-17', 1, 0.8, 0.2)]);
  await writeFile(first, original);
  await writeFile(second, csv(monthlyHeaders, [monthly()]));
  const result = await auditSources(root);
  assert.equal(result.passed, false, 'Small test fixtures must not be forced to match the real expected counts.');
  assert.match(result.composite.sha256, /^[a-f0-9]{64}$/);
  assert.equal(await readFile(first, 'utf8'), original);
  const report = renderAuditReport(result);
  assert.match(report, /Dry-run result: FAIL/);
  assert.match(report, /not an exact Story County/);
  assert.match(report, /Monthly medians cannot be independently reconstructed/);
});

test('CLI fails when its process environment has no data root', () => {
  const entry = fileURLToPath(new URL('../scripts/auditModisSource.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry], { env: { ...process.env, TERRAPULSE_DATA_ROOT: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TERRAPULSE_DATA_ROOT is unavailable/);
  assert.equal(result.stdout, '');
});
