import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditPowerCsv, auditPowerSource, POWER_HEADERS, POWER_SNAPSHOT } from '../scripts/auditPowerSource.js';

// Synthetic audit-only records. Never NASA data, source replacements, or database fixtures.
function fixture(changes = {}) {
  const row = {
    location_id: 'DG001', latitude: 41, longitude: -93, year: 2020, month: 2,
    month_start: '2020-02-01', month_end: '2020-02-29', days_expected: 29, days_present: 29,
    complete: 'True', T2M_mean: 5, T2M_MAX_mean: 6, T2M_MIN_mean: 4,
    PRECTOTCORR_total: 58, PRECTOTCORR_daily_mean: 2,
    ALLSKY_SFC_SW_DWN_total: 87, ALLSKY_SFC_SW_DWN_daily_mean: 3, RH2M_mean: 70, ...changes,
  };
  return POWER_HEADERS.map((column) => row[column]).join(',');
}
const csv = (...rows) => POWER_HEADERS.join(',') + '\n' + rows.join('\n') + '\n';

test('POWER audit reads exact source columns/types and reports incomplete inventories without inventing rows or units', () => {
  const audit = auditPowerCsv(csv(fixture()));
  assert.equal(audit.headerMatch, true);
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.passed, false); // One record is deliberately not the approved 432-row working snapshot.
  assert.deepEqual(audit.completeTokens, { True: 1 });
  assert.equal(audit.schema.find((column) => column.name === 'complete').observedTypes[0], 'boolean');
  assert.deepEqual(audit.invalidValues, []);
  assert.equal(audit.locations[0].missingMonths.length, 107);
  assert.deepEqual(audit.missingVariables, ['WS10M']);
  assert.equal(audit.unitVerificationStatus, 'unverified_no_snapshot_unit_metadata');
});

test('POWER calendar and completeness checks distinguish leap-year bounds and present-day denominators', () => {
  const audit = auditPowerCsv(csv(fixture({ days_present: 28, complete: 'False', PRECTOTCORR_total: 56, ALLSKY_SFC_SW_DWN_total: 84 })));
  assert.equal(audit.locations[0].incompleteCount, 1);
  assert.equal(audit.dayCountMismatches, 1);
  assert.ok(!audit.errors.some((error) => ['complete', 'days_expected', 'days_present', 'month_start/month_end'].includes(error.column)));
  assert.equal(audit.reconciliation[0].maximumDifference, 0);
  assert.equal(audit.reconciliation[0].maximumExpectedDaysDifference, 2);
  const invalid = auditPowerCsv(csv(fixture({ month_end: '2020-02-28', days_expected: 28 })));
  assert.ok(invalid.errors.some((error) => error.column === 'month_start/month_end'));
  assert.ok(invalid.errors.some((error) => error.column === 'days_expected'));
});

test('POWER duplicate months, coordinate changes, invalid numerics, and missing values remain distinct', () => {
  const audit = auditPowerCsv(csv(fixture(), fixture({ latitude: 42, T2M_mean: '', RH2M_mean: 'NaN', PRECTOTCORR_total: 'Infinity' })));
  assert.equal(audit.duplicateKeys[0].count, 2);
  assert.equal(audit.locations[0].coordinates.length, 2);
  assert.equal(audit.missingValues.length, 2);
  assert.equal(audit.invalidValues.length, 1);
  assert.equal(audit.schema.find((column) => column.name === 'T2M_mean').nullCount, 1);
  assert.equal(audit.schema.find((column) => column.name === 'PRECTOTCORR_total').invalidCount, 1);
});

test('POWER arithmetic checks detect total/mean conflicts without changing the supplied values', () => {
  const audit = auditPowerCsv(csv(fixture({ PRECTOTCORR_total: 59 })));
  assert.equal(audit.reconciliation[0].tested, 1);
  assert.equal(audit.reconciliation[0].mismatches[0].difference, 1);
  assert.equal(audit.schema.find((column) => column.name === 'PRECTOTCORR_total').statistics.min, 59);
  assert.equal(audit.schema.find((column) => column.name === 'PRECTOTCORR_daily_mean').statistics.min, 2);
  assert.throws(() => auditPowerCsv(csv(fixture()).replace('location_id,latitude', 'latitude,latitude')), /unique/);
});

test('POWER source requires an explicit root and reports changed fingerprints without any source writes', async (t) => {
  await assert.rejects(auditPowerSource(''), /TERRAPULSE_DATA_ROOT/);
  await assert.rejects(auditPowerSource('relative'), /absolute/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'terrapulse-power-audit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, ...POWER_SNAPSHOT.relativePath.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  const original = csv(fixture());
  await writeFile(file, original);
  const audit = await auditPowerSource(directory);
  assert.equal(audit.fingerprintMatch, false);
  assert.equal(audit.passed, false);
  assert.equal(audit.databaseAccessed, false);
  assert.equal(audit.ingestionAuthorized, false);
  assert.equal(audit.sourceUnchanged, true);
  assert.equal(await readFile(file, 'utf8'), original);
});
