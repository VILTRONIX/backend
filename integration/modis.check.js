// Opt-in, read-only live checks. No test fixtures or index changes are saved in Atlas.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { getDatasetModel } from '../src/modules/datasets/dataset.model.js';
import { getDatasetAssetModel } from '../src/modules/datasets/dataset-asset.model.js';
import { getStudyAreaModel } from '../src/modules/study-areas/study-area.model.js';
import { getVegetationObservationModel } from '../src/modules/vegetation/vegetation-observation.model.js';
import { validateModisSources, planModisImport, canonical } from '../src/modules/vegetation/modis-import.service.js';
import { MODIS_SLUG, AOI_KEY, SPATIAL_PROVENANCE, SOURCE_MAPPING } from '../src/modules/vegetation/vegetation.constants.js';
import { serve, captureLogger } from '../tests/helpers/http.js';

test('Atlas: all MODIS source values, actual indexes, lifecycle, public APIs, and read-only preservation', { timeout: 90000 }, async (t) => {
  const sources = await validateModisSources(process.env.TERRAPULSE_DATA_ROOT);
  const config = loadEnv();
  assert.ok(config.mongodbUri, 'MONGODB_URI is required for this opt-in integration check.');
  const database = createDatabase({ uri: config.mongodbUri, logger: captureLogger() });
  t.after(() => database.stop());
  database.start();
  for (let attempt = 0; attempt < 150 && !database.isReady(); attempt += 1) await delay(100);
  assert.equal(database.isReady(), true, 'Atlas did not become ready.');
  const connection = database.getConnection();
  const Dataset = getDatasetModel(connection), Asset = getDatasetAssetModel(connection);
  const Area = getStudyAreaModel(connection), Observation = getVegetationObservationModel(connection);
  const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
  async function snapshot() {
    // Sequential reads keep this check simple and bounded. Includes private fields in the hash only.
    const result = {};
    for (const Model of [Dataset, Asset, Area, Observation]) result[Model.collection.collectionName] = hash(await Model.find().select('+storageUri +metadata +evidenceReference').sort({ _id: 1 }).lean().maxTimeMS(5000));
    return result;
  }
  const before = await snapshot();
  const plan = await planModisImport(connection, sources);
  assert.deepEqual(plan.counts, { sourceObservations: 315, newObservations: 0, existingObservations: 315, newAssets: 0, existingAssets: 2, updates: 0 });
  assert.equal(plan.dataset.acquisition.status, 'request_completed');
  assert.equal(plan.dataset.validation.status, 'validated');
  assert.equal(plan.dataset.processing.status, 'completed');
  assert.equal(plan.dataset.processedSummaryAvailability.rawProductVerifiedByThisImport, false);
  assert.equal(await Dataset.countDocuments(), 8);
  assert.equal(await Area.countDocuments({ geoid: '19169' }), 1);
  assert.equal(await Asset.countDocuments({ datasetId: plan.dataset._id }), 2);
  const rows = await Observation.find({ datasetId: plan.dataset._id, aoiKey: AOI_KEY }).lean().maxTimeMS(5000);
  for (const resolution of ['16day', 'monthly']) {
    const actual = rows.filter((row) => row.resolution === resolution);
    assert.equal(actual.length, resolution === '16day' ? 207 : 108);
    assert.equal(new Set(actual.map((row) => row.periodKey)).size, actual.length);
    const byKey = new Map(actual.map((row) => [row.periodKey, row]));
    for (const source of sources.sources[resolution].audit.records) {
      const row = byKey.get(source.date ?? source.month);
      for (const [column, field] of Object.entries(SOURCE_MAPPING)) if (Object.hasOwn(source, column)) assert.deepEqual(row[field], source[column], `${resolution}/${row.periodKey}/${column}`);
      for (const [key, value] of Object.entries(SPATIAL_PROVENANCE)) assert.equal(row[key], value);
    }
    assert.equal(actual.filter((row) => row.ndviMean === null && row.eviMean === null).length, resolution === '16day' ? 18 : 2);
  }
  const duplicates = await Observation.aggregate([{ $group: { _id: { datasetId: '$datasetId', aoiKey: '$aoiKey', resolution: '$resolution', periodKey: '$periodKey' }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }]).option({ maxTimeMS: 5000 });
  assert.deepEqual(duplicates, []);
  for (const Model of [Observation, Asset]) {
    const indexes = await Model.listIndexes();
    for (const [key, options] of Model.schema.indexes()) {
      const index = indexes.find((entry) => entry.name === options.name);
      assert.ok(index, options.name);
      assert.deepEqual(index.key, key);
      assert.equal(Boolean(index.unique), Boolean(options.unique));
    }
    t.diagnostic(`${Model.collection.collectionName} indexes: ${JSON.stringify(indexes)}`);
  }
  const base = await serve(createApp({ config, database, logger: captureLogger() }), t);
  async function get(path, status = 200) {
    const response = await fetch(base + path);
    assert.equal(response.status, status, path);
    const text = await response.text();
    assert.ok(!/storageUri|evidenceReference|["\s][A-Za-z]:[\\/]|mongodb(?:\+srv)?:|TerraPulseData|contentHash/.test(text), `Public payload must not expose private storage/configuration: ${path}`);
    const body = JSON.parse(text);
    assert.equal(body.success, status === 200);
    assert.ok(body.requestId);
    if (status === 200 && path.includes('/observations/')) {
      assert.equal(body.data.metadata.product, 'MOD13Q1.061');
      assert.equal(body.data.metadata.nativeSpatialResolutionMeters, 250);
      for (const [key, value] of Object.entries(SPATIAL_PROVENANCE)) assert.equal(body.data.metadata[key], value);
      assert.equal(body.data.metadata.datasetReadiness.ready, false);
      assert.equal(body.data.metadata.rasterRenderingSupported, false);
    }
    return body.data;
  }
  const prefix = '/api/v1/observations/vegetation';
  assert.equal((await get(`${prefix}?limit=100`)).pagination.total, 207);
  assert.equal((await get(`${prefix}?page=3&limit=100`)).items.length, 7);
  assert.equal((await get(`${prefix}/?resolution=monthly`)).pagination.total, 108);
  assert.equal((await get(`${prefix}?geoid=19169&areaId=${plan.area._id}&startDate=2017-01-01&endDate=2017-01-01`)).items.length, 1);
  assert.equal((await get(`${prefix}?geoid=00000`)).pagination.total, 0);
  assert.equal((await get(`${prefix}?areaId=000000000000000000000000`)).pagination.total, 0);
  for (const [resolution, count, missing] of [['16day', 207, 18], ['monthly', 108, 2]]) {
    const result = await get(`${prefix}/summary?resolution=${resolution}`);
    assert.equal(result.recordCount, count);
    assert.equal(result.validObservationCount, count - missing);
    assert.equal(result.missingObservationCount, missing);
    assert.equal(result.pixelCoverage.totalPixelObservations, 7778025);
    assert.equal(result.pixelCoverage.ndviValidPixelObservations, 5919724);
    const valid = rows.filter((row) => row.resolution === resolution && row.ndviMean !== null);
    assert.ok(Math.abs(result.statistics.ndvi.averagePeriodMean - valid.reduce((sum, row) => sum + row.ndviMean, 0) / valid.length) < 1e-12);
    assert.equal(result.statistics.ndvi.minimumPeriodMean, Math.min(...valid.map((row) => row.ndviMean)));
    assert.equal(result.statistics.ndvi.maximumPeriodMean, Math.max(...valid.map((row) => row.ndviMean)));
  }
  for (const month of ['2019-02', '2021-01']) {
    const { observation } = await get(`${prefix}/${month}?resolution=monthly`);
    assert.equal(observation.month, month);
    for (const field of ['ndviMean', 'ndviMedian', 'ndviStd', 'eviMean', 'eviMedian', 'eviStd']) assert.equal(observation[field], null);
    const result = await get(`${prefix}/summary?resolution=monthly&startDate=${month}&endDate=${month}`);
    assert.equal(result.recordCount, 1);
    assert.equal(result.validObservationCount, 0);
    assert.equal(result.statistics.ndvi.averagePeriodMean, null);
    assert.equal(result.statistics.ndvi.minimumPeriodMean, null);
    assert.equal(result.statistics.evi.maximumPeriodMean, null);
    assert.deepEqual(result.missingPeriods, [month]);
  }
  assert.equal((await get(`${prefix}/2017-01-01`)).observation.periodKey, '2017-01-01');
  await get(`${prefix}/2017-01-02`, 404);
  await get(`${prefix}/2019-02-30`, 400);
  await get(`${prefix}/summary`, 400);
  await get(`${prefix}?resolution=monthly&startDate=2017-01-01`, 400);
  await get(`${prefix}?areaId=invalid`, 400);
  const empty = await get(`${prefix}/summary?resolution=monthly&startDate=2030-01&endDate=2030-12`);
  assert.equal(empty.recordCount, 0);
  assert.equal(empty.statistics.ndvi.averagePeriodMean, null);
  const registry = await get(`/api/v1/datasets/${MODIS_SLUG}`);
  assert.equal(registry.readiness.ready, false);
  assert.equal(registry.processedSummaryAvailability.status, 'available');
  assert.equal((await get(`/api/v1/datasets/${MODIS_SLUG}/assets`)).pagination.total, 2);
  const countyCoverage = await get(`/api/v1/study-areas/${plan.area._id}/coverage`);
  const modisCoverage = countyCoverage.items.find((entry) => entry.dataset.slug === MODIS_SLUG);
  assert.equal(modisCoverage.coverage.status, 'unknown');
  assert.equal(modisCoverage.availability.analysisReady, false);
  assert.equal(modisCoverage.processedSummaryAvailability.exactCountyStatistics, false);
  assert.deepEqual(await snapshot(), before, 'Read-only integration check changed persisted documents.');
  t.diagnostic('Verified 315 complete source rows, 2 assets, 18/2 null rows, actual unique indexes, and unchanged collection hashes.');
});
