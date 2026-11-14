import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { unlink, readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { createScenarioComparisonService, parseComparisonQuery } from '../src/modules/scenarios/scenario.comparison.js';
import { finalFixture } from './helpers/engine-v1.js';
import { serve, captureLogger } from './helpers/http.js';

async function setup(t, decorate = (engine) => engine) {
  const fixture = await finalFixture(t), logger = captureLogger();
  const engine = decorate(createEngineService({ engineRoot: fixture.root }));
  const database = { isReady: () => false, getStatus: () => ({ configured: false, ready: false, status: 'unconfigured' }),
    getConnection() { throw new Error('Comparison must not use MongoDB.'); } };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: fixture.root }), database, engineService: engine, logger }), t);
  return { fixture, engine, base, logger, comparison: createScenarioComparisonService({ engineService: engine }) };
}
const comparePath = '/api/v1/scenarios/comparison';
const syntheticPeriod = { startYear: '2020', endYear: '2021' };

test('comparison query defaults and custom values reuse year validation with strict optional inclusion', () => {
  assert.deepEqual(parseComparisonQuery(), { startYear: 2021, endYear: 2025, includeMerra2: false });
  assert.deepEqual(parseComparisonQuery({ startYear: '2022' }), { startYear: 2022, endYear: 2025, includeMerra2: false });
  assert.deepEqual(parseComparisonQuery({ endYear: '2023', includeMerra2: 'true' }), { startYear: 2021, endYear: 2023, includeMerra2: true });
  for (const query of [{ startYear: '2026' }, { endYear: '2020' }, { startYear: '2025', endYear: '2021' },
    { startYear: '-1' }, { startYear: '20' }, { startYear: '2021.0' }, { startYear: ['2021', '2022'] }, { endYear: {} },
    { includeMerra2: 'True' }, { includeMerra2: '1' }, { includeMerra2: true }, { includeMerra2: ['true', 'false'] },
    { page: '1' }, { weights: '{}' }, { arbitrary: 'private-value' }]) {
    assert.throws(() => parseComparisonQuery(query), (error) => error.code === 'INVALID_COMPARISON_QUERY' && !error.message.includes('private-value'));
  }
});

test('comparison HTTP response supplies all three evidence sections and original transition denominators', async (t) => {
  const { base, fixture } = await setup(t);
  const response = await fetch(`${base}${comparePath}?startYear=2020&endYear=2021`), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.success, true);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  const data = body.data;
  assert.deepEqual(data.selectedPeriod, { startYear: 2020, endYear: 2021 });
  assert.equal(data.currentRotation.scenario.id, 'current_rotation');
  assert.equal(data.waterFirst.scenario.id, 'water_first');
  assert.equal(data.soilFirst.scenario.id, 'soil_first');
  assert.equal(data.currentRotation.annualCropDistribution.years[0].records.length, 3);
  assert.equal(data.currentRotation.cropClassDistribution.years[0].records.length, 3);
  assert.deepEqual(data.currentRotation.observedTransitions.yearPairs[0].records, fixture.forLogicalId('usda_crop_transitions').rows);
  assert.ok(data.currentRotation.observedTransitions.yearPairs[0].records.every((row) => row.common_valid_area_ha === 0.81));
  assert.equal(Object.keys(data.datasetProvenance).length, 7);
  assert.equal(data.datasetProvenance.usda_crop_transitions.metadata.fields.common_valid_area_ha.unit, 'synthetic-unit');
  assert.equal(data.metadata.comparisonMode, 'descriptive_evidence');
  assert.equal(data.metadata.scenarioScoresGenerated, false);
  assert.equal(data.metadata.scientificEvaluationStatus, 'not_implemented');
  assert.equal(data.metadata.recommendationGenerationEnabled, false);
  assert.ok(data.unavailableIndicators.some((entry) => entry.indicator === 'water_savings'));
  assert.ok(!JSON.stringify(body).includes(fixture.root));
});

test('default years retain static soil evidence and identify empty temporal selections honestly', async (t) => {
  const { base } = await setup(t);
  const data = (await (await fetch(`${base}${comparePath}`)).json()).data;
  assert.deepEqual(data.selectedPeriod, { startYear: 2021, endYear: 2025 });
  assert.equal(data.currentRotation.annualCropDistribution.selectedRecordCount, 0, 'Synthetic annual crop data exists only in 2020.');
  assert.equal(data.datasetSelections.usda_annual.status, 'no_records_in_period');
  assert.equal(data.soilFirst.mapUnits.selectedRecordCount, 2);
  assert.equal(data.datasetSelections.soil_map_units.declaredPeriodRelation, 'static');
  assert.equal(data.merra2Context.status, 'not_requested');
});

test('POWER locations remain separate and MODIS records preserve temporal precision, nulls and QA', async (t) => {
  const { comparison, fixture } = await setup(t);
  const data = await comparison.compare(syntheticPeriod);
  assert.equal(data.waterFirst.power.locations.length, 2);
  for (const point of data.waterFirst.power.locations) {
    assert.equal(point.records.length, 2);
    assert.ok(point.records.every((row) => row.location_id === point.location_id));
  }
  assert.deepEqual(data.waterFirst.power.locations.flatMap((point) => point.records), fixture.forLogicalId('power_monthly').rows);
  assert.equal(data.waterFirst.modisMonthly.records[1].month, '2020-02');
  assert.equal(data.waterFirst.modisMonthly.records[1].ndvi_mean, null);
  assert.equal(data.waterFirst.modisMonthly.observationCounts.bothAvailablePeriods, 1);
  assert.equal(data.waterFirst.modis16day.observationCounts.neitherAvailablePeriods, 1);
  assert.equal(data.waterFirst.modis16day.records[0].date, '2020-01-01');
  assert.equal(data.waterFirst.modis16day.records[0].vi_usefulness_distribution_before_filter, '{"0":10}');
  const oneYear = await comparison.compare({ startYear: '2020', endYear: '2020' });
  assert.equal(oneYear.waterFirst.modis16day.selectedRecordCount, 1);
  assert.equal(oneYear.waterFirst.modisMonthly.selectedRecordCount, 2);
  assert.equal(oneYear.currentRotation.observedTransitions.selectedRecordCount, 0, 'A pair ending outside the period must be excluded.');
});

test('soil attributes remain static, string-keyed and null-preserving with explicit indicator availability', async (t) => {
  const { comparison, fixture } = await setup(t);
  const data = await comparison.compare(syntheticPeriod);
  assert.deepEqual(data.soilFirst.mapUnits.records, fixture.forLogicalId('soil_map_units').rows);
  assert.equal(data.soilFirst.mapUnits.records[0].mukey, '001');
  assert.equal(data.soilFirst.fieldAssignmentStatus, 'not_available');
  assert.equal(data.missingValues.soil_map_units.nullCounts.root_zone_aws_0_150cm_mm, 2);
  assert.ok(data.missingValues.soil_map_units.allNullFields.includes('root_zone_aws_0_150cm_mm'));
  assert.ok(!data.availableIndicators.soil_map_units.some((entry) => entry.field === 'root_zone_aws_0_150cm_mm'));
  assert.ok(data.unavailableIndicators.some((entry) => entry.datasetId === 'soil_map_units' && entry.indicator === 'root_zone_aws_0_150cm_mm'));
});

test('optional MERRA-2 uses separate native cells and retains negative flux values', async (t) => {
  const { comparison } = await setup(t);
  const data = await comparison.compare({ ...syntheticPeriod, includeMerra2: 'true' });
  assert.equal(data.merra2Context.requested, true);
  assert.equal(data.merra2Context.status, 'available');
  assert.equal(data.merra2Context.cells.length, 2);
  for (const cell of data.merra2Context.cells) {
    assert.equal(cell.records.length, 2);
    assert.ok(cell.records.every((row) => row.longitude === cell.longitude && row.HFLUX === -2));
  }
});

test('missing optional MERRA-2 degrades only context and is never loaded unless requested', async (t) => {
  const calls = [];
  const { fixture, comparison } = await setup(t, (engine) => ({ ...engine, readDataset(id, query) { calls.push(id); return engine.readDataset(id, query); } }));
  await unlink(path.join(fixture.root, fixture.forLogicalId('merra2_context').entry.path));
  assert.equal((await comparison.compare(syntheticPeriod)).merra2Context.status, 'not_requested');
  assert.ok(!calls.includes('merra2_context'));
  const data = await comparison.compare({ ...syntheticPeriod, includeMerra2: 'true' });
  assert.equal(data.merra2Context.status, 'unavailable');
  assert.equal(data.merra2Context.availabilityStatus, 'missing_file');
  assert.equal(data.currentRotation.annualCropDistribution.selectedRecordCount, 3);
  assert.equal(Object.keys(data.datasetProvenance).length, 7);
});

test('out-of-coverage years produce empty time series rather than fabricated records or clipped periods', async (t) => {
  const { comparison } = await setup(t);
  const data = await comparison.compare({ startYear: '1990', endYear: '1991', includeMerra2: 'true' });
  assert.deepEqual(data.selectedPeriod, { startYear: 1990, endYear: 1991 });
  assert.deepEqual(data.waterFirst.power.locations, []);
  assert.deepEqual(data.currentRotation.observedTransitions.yearPairs, []);
  assert.equal(data.datasetSelections.power_monthly.declaredPeriodRelation, 'outside_declared_coverage');
  assert.equal(data.merra2Context.status, 'no_records_in_period');
  assert.equal(data.soilFirst.mapUnits.selectedRecordCount, 2);
});

test('comparison drains Engine pages and retains every selected record without bypassing its loader', async (t) => {
  const calls = [];
  const { comparison } = await setup(t, (engine) => ({ ...engine, readDataset(id, query) {
    calls.push({ id, page: query.page }); return engine.readDataset(id, { ...query, limit: '2' });
  } }));
  const data = await comparison.compare(syntheticPeriod);
  assert.equal(data.waterFirst.power.selectedRecordCount, 4);
  assert.equal(data.currentRotation.observedTransitions.selectedRecordCount, 9);
  assert.deepEqual(calls.filter((call) => call.id === 'power_monthly').map((call) => call.page), ['1', '2']);
});

test('source changes across pages or datasets fail instead of mixing provenance', async (t) => {
  for (const mismatch of ['page', 'dataset']) {
    const fixture = await finalFixture(t), engine = createEngineService({ engineRoot: fixture.root });
    const comparison = createScenarioComparisonService({ engineService: { ...engine, async readDataset(id, query) {
      const result = await engine.readDataset(id, { ...query, limit: '2' });
      if (mismatch === 'page' && query.page === '2' || mismatch === 'dataset' && id === 'power_monthly') result.dataset.provenance.manifestChecksum = 'different-version';
      return result;
    } } });
    await assert.rejects(comparison.compare(syntheticPeriod), (error) => error.code === 'COMPARISON_SOURCE_CHANGED');
  }
});

test('missing required evidence produces safe 503 and invalid query produces safe 400 before file reads', async (t) => {
  let reads = 0;
  const { fixture, base, logger } = await setup(t, (engine) => ({ ...engine, readDataset(id, query) { reads++; return engine.readDataset(id, query); } }));
  const invalid = await fetch(`${base}${comparePath}?includeMerra2=private-value`), invalidBody = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.equal(invalidBody.error.code, 'INVALID_COMPARISON_QUERY');
  assert.equal(reads, 0);
  await unlink(path.join(fixture.root, fixture.forLogicalId('usda_annual').entry.path));
  const unavailable = await fetch(`${base}${comparePath}`), body = await unavailable.json();
  assert.equal(unavailable.status, 503);
  assert.equal(body.error.code, 'ENGINE_DATASET_UNAVAILABLE');
  assert.equal(body.error.details.datasetId, 'usda_annual');
  assert.ok(!JSON.stringify(body).includes(fixture.root));
  assert.doesNotMatch(JSON.stringify(invalidBody) + logger.messages.join('\n'), /private-value/);
});

test('bounded collection, supported contract, and unexpected errors remain explicit failures', async (t) => {
  const { engine } = await setup(t);
  const bounded = createScenarioComparisonService({ engineService: engine, maxRecords: 2 });
  await assert.rejects(bounded.compare(syntheticPeriod), (error) => error.code === 'COMPARISON_RECORD_LIMIT');
  const unsupported = createScenarioComparisonService({ engineService: { ...engine, async readDataset(...args) {
    const result = await engine.readDataset(...args); result.dataset.metadata.contractVersion = 'other'; return result;
  } } });
  await assert.rejects(unsupported.compare(syntheticPeriod), (error) => error.code === 'COMPARISON_CONTRACT_UNAVAILABLE');
  const { base, logger } = await setup(t, (engine) => ({ ...engine, async readDataset(id, query) {
    if (id === 'merra2_context') throw new Error('private-error-marker'); return engine.readDataset(id, query);
  } }));
  const response = await fetch(`${base}${comparePath}?startYear=2020&endYear=2021&includeMerra2=true`), body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(body) + logger.messages.join('\n'), /private-error-marker/);
});

test('comparison is stateless, preserves source bytes, and leaves existing Scenario responses unchanged', async (t) => {
  const { fixture, base } = await setup(t);
  const beforeCatalog = await (await fetch(`${base}/api/v1/scenarios`)).json();
  const manifest = path.join(fixture.root, 'data/processed/features/feature_manifest.json');
  const before = await readFile(manifest);
  await (await fetch(`${base}${comparePath}?startYear=2020&endYear=2021`)).json();
  const again = await (await fetch(`${base}/api/v1/scenarios`)).json();
  assert.deepEqual(again.data, beforeCatalog.data);
  assert.deepEqual(await readFile(manifest), before);
  const preferences = await fetch(`${base}/api/v1/scenarios/preferences/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights: { water: 50, soilHealth: 30, productivity: 20 } }) });
  assert.deepEqual((await preferences.json()).data.normalizedWeights, { water: 0.5, soilHealth: 0.3, productivity: 0.2 });
});
