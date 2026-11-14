import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { finalFixture, csvBytes, hash } from './helpers/engine-v1.js';
import { serve, captureLogger } from './helpers/http.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { validateDailyTable, parseDailyQuery } from '../src/modules/engine/engine.power-daily.js';
import { parseCsv } from '../src/utils/csv.js';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createScenarioComparisonService } from '../src/modules/scenarios/scenario.comparison.js';

async function fixture(t) {
  const base = await finalFixture(t), dir = path.join(base.root, 'data/processed/features/supplemental');
  await mkdir(dir, { recursive: true });
  const units = { T2M_MAX: 'C', T2M_MIN: 'C', T2M: 'C', RH2M: '%', WS10M: 'm/s', ALLSKY_SFC_SW_DWN: 'MJ/m^2/day', PRECTOTCORR: 'mm/day', PS: 'kPa', T2MDEW: 'C' };
  const rows = Array.from({ length: 1826 }, (_, index) => {
    const date = new Date(Date.UTC(2021, 0, index + 1)), year = date.getUTCFullYear();
    return { date: date.toISOString().slice(0, 10), latitude: 42.0375, longitude: -93.4661, YEAR: year,
      DOY: 1 + (date.getTime() - Date.UTC(year, 0, 1)) / 86400000,
      T2M_MAX: 10, T2M_MIN: 0, T2M: 5, RH2M: 50, WS10M: 2, ALLSKY_SFC_SW_DWN: 10, PRECTOTCORR: 1, PS: 99, T2MDEW: 1 };
  });
  const metadata = { dataset_name: 'power_daily_context', source: 'NASA POWER Daily Point API', time_standard: 'UTC', temporal_grain: 'Daily UTC',
    date_coverage: { start: '2021-01-01', end: '2025-12-31', inclusive: true }, primary_key: ['date'], columns: Object.keys(rows[0]),
    returned_coordinates: { latitude: 42.0375, longitude: -93.4661 }, requested_coordinates: { latitude: 42.0375, longitude: -93.4661 },
    parameter_metadata: Object.fromEntries(Object.entries(units).map(([k, unit]) => [k, { unit, description: 'SYNTHETIC TEST ONLY' }])),
    optional_T2MDEW: { available: true }, missing_value_policy: { source_fill_value: -999, imputation: 'none' },
    validation: { status: 'PASS', actual_records: 1826, expected_records: 1826,
      screen_ranges: { PS: [50, 110] }, missing_values: {}, fill_values: {} }, checksums: {} };
  const publish = async () => {
    for (const key of Object.keys(units)) {
      metadata.validation.fill_values[key] = rows.filter(r => r[key] === -999).length;
      metadata.validation.missing_values[key] = rows.filter(r => r[key] === '' || r[key] === -999).length;
    }
    const csv = csvBytes(metadata.columns, rows); metadata.checksums.output_csv = hash(csv);
    const meta = JSON.stringify(metadata), audit = 'SYNTHETIC TEST AUDIT ONLY';
    for (const [name, body] of [['power_daily_context.csv', csv], ['power_daily_context_metadata.json', meta], ['power_daily_context_audit.md', audit]]) await writeFile(path.join(dir, name), body);
    await writeFile(path.join(dir, 'checksums.sha256'), [[hash(csv), 'power_daily_context.csv'], [hash(meta), 'power_daily_context_metadata.json'], [hash(audit), 'power_daily_context_audit.md']].map(([sha, name]) => `${sha}  ${name}`).join('\n') + '\n');
  };
  await publish(); return { ...base, rows, metadata, dir, publish, engine: createEngineService({ engineRoot: base.root }) };
}

test('daily supplement validates 1,826 UTC dates, optional ninth variable, units, pagination and leap-day filtering', async t => {
  const f = await fixture(t), all = await f.engine.readDaily({ limit: '100' });
  assert.equal(all.dataset.recordCount, 1826); assert.equal(all.pagination.total, 1826); assert.equal(all.items.length, 100);
  assert.equal(all.items[0].date, '2021-01-01'); assert.equal(all.dataset.metadata.timeStandard, 'UTC');
  for (const [field, declaration] of Object.entries(f.metadata.parameter_metadata)) assert.equal(all.dataset.metadata.fields[field].unit, declaration.unit);
  const leap = await f.engine.readDaily({ startDate: '2024-02-29', endDate: '2024-02-29' });
  assert.equal(leap.items.length, 1); assert.equal(leap.items[0].DOY, 60); assert.equal(leap.items[0].date, '2024-02-29');
  const year = await f.engine.readDaily({ startDate: '2024-01-01', endDate: '2024-12-31' }); assert.equal(year.pagination.total, 366);
  const last = await f.engine.readDaily({ page: '19', limit: '100' }); assert.equal(last.items.at(-1).date, '2025-12-31'); assert.equal(last.items.length, 26);
  const empty = await f.engine.readDaily({ startDate: '2020-01-01', endDate: '2020-12-31' }); assert.equal(empty.pagination.total, 0);
});

test('documented blank/fill observations become null, remain counted, and true zero stays zero', async t => {
  const f = await fixture(t); f.rows[0].T2M = ''; f.rows[1].T2M = -999; f.rows[0].PRECTOTCORR = 0; await f.publish();
  const data = await f.engine.readDaily(); assert.equal(data.items[0].T2M, null); assert.equal(data.items[1].T2M, null);
  assert.equal(data.items[0].PRECTOTCORR, 0); assert.equal(data.dataset.metadata.missingValues.T2M, 2); assert.equal(data.dataset.metadata.fillValues.T2M, 1);
  assert.equal(data.dataset.provenance.rawSourceChecksum, null, 'Undocumented source provenance is not fabricated.');
});

test('table validation rejects duplicates, gaps, calendar errors, malformed observations, units and coordinates', async t => {
  const f = await fixture(t), bytes = await readFile(path.join(f.dir, 'power_daily_context.csv'), 'utf8');
  for (const mutate of [
    (table) => { table.rows[1][0] = table.rows[0][0]; },
    (table) => { table.rows.pop(); },
    (table) => { table.rows[364][4] = '366'; },
    (table) => { table.rows[0][1] = '43'; },
    (table) => { table.rows[0][7] = 'NaN'; },
    (table) => { table.rows[0][7] = 'NULL'; },
    (table) => { table.rows[0][12] = '1000'; },
    (table) => { table.headers[0] = 'timestamp'; },
  ]) {
    const table = parseCsv(bytes); mutate(table); assert.throws(() => validateDailyTable(table, f.metadata));
  }
  const metadata = structuredClone(f.metadata); metadata.parameter_metadata.PS.unit = 'Pa';
  assert.throws(() => validateDailyTable(parseCsv(bytes), metadata), e => e.reason === 'daily_parameter_contract_mismatch');
});

test('daily query validation follows existing bounds and permits day precision only', () => {
  assert.deepEqual(parseDailyQuery(), { page: 1, limit: 20 });
  for (const q of [{ year: '2024' }, { startDate: '2024-01' }, { startDate: '2023-02-29' }, { page: '0' }, { limit: '101' },
    { startDate: ['2024-01-01'] }, { startDate: '2025-01-01', endDate: '2024-01-01' }]) assert.throws(() => parseDailyQuery(q), e => e.code === 'INVALID_ENGINE_QUERY');
});

test('CSV, metadata and audit checksums fail closed after a cached load and recover after repair', async t => {
  for (const name of ['power_daily_context.csv', 'power_daily_context_metadata.json', 'power_daily_context_audit.md']) {
    const f = await fixture(t), file = path.join(f.dir, name); await f.engine.readDaily(); const original = await readFile(file);
    await writeFile(file, Buffer.concat([original, Buffer.from('\n')]));
    await assert.rejects(f.engine.readDaily(), e => e.code === 'ENGINE_DATASET_UNAVAILABLE' && e.details.optional && e.details.reason === 'daily_checksum_mismatch');
    await writeFile(file, original); assert.equal((await f.engine.readDaily()).dataset.recordCount, 1826);
  }
});

test('daily endpoint uses existing snapshot cache, request envelope, no-store and safe errors', async t => {
  const f = await fixture(t), database = { isReady: () => false, getStatus: () => ({ ready: false }), getConnection() { throw new Error('No MongoDB allowed.'); } };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: f.root }), database, engineService: f.engine, logger: captureLogger() }), t);
  const r = await fetch(base + '/api/v1/engine/climate/daily?startDate=2024-01-01&endDate=2024-01-31&limit=31'), b = await r.json();
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-request-id'), b.requestId); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(b.data.pagination.total, 31); assert.ok(!JSON.stringify(b).includes(f.root));
  const hits = f.engine.getCacheStats().hits; await f.engine.readDaily(); assert.ok(f.engine.getCacheStats().hits > hits);
  const bad = await fetch(base + '/api/v1/engine/climate/daily?year=2024'); assert.equal(bad.status, 400);
  await unlink(path.join(f.dir, 'power_daily_context.csv'));
  const missing = await fetch(base + '/api/v1/engine/climate/daily'); assert.equal(missing.status, 503); const error = await missing.json();
  assert.equal(error.error.code, 'ENGINE_DATASET_UNAVAILABLE'); assert.equal(error.error.details.optional, true); assert.ok(!JSON.stringify(error).includes(f.root));
  assert.equal((await fetch(base + '/health/engine')).status, 200);
});

test('missing optional files or Engine root do not block original monthly, catalog or comparison contracts', async t => {
  const f = await fixture(t), compare = createScenarioComparisonService({ engineService: f.engine });
  const query = { startYear: '2020', endYear: '2021' }, before = await compare.compare(query), monthly = await f.engine.readDataset('power_monthly');
  await f.engine.readDaily(); await unlink(path.join(f.dir, 'checksums.sha256'));
  await assert.rejects(f.engine.readDaily(), e => e.code === 'ENGINE_DATASET_UNAVAILABLE' && e.details.optional);
  assert.deepEqual(await compare.compare(query), before); assert.deepEqual(await f.engine.readDataset('power_monthly'), monthly);
  assert.equal((await f.engine.listDatasets()).items.length, 8); assert.equal((await f.engine.getHealth()).ready, true);
  await assert.rejects(createEngineService({ featuresRoot: f.root }).readDaily(), e => e.details.reason === 'engine_root_not_configured');
});
