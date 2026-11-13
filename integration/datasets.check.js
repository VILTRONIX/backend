// Opt-in live, read-only registry verification. No source files or test assets are created.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { getDatasetModel } from '../src/modules/datasets/dataset.model.js';
import { getDatasetAssetModel } from '../src/modules/datasets/dataset-asset.model.js';
import { getStudyAreaModel } from '../src/modules/study-areas/study-area.model.js';
import { getReadiness, parseDatasetQuery, ACQUISITION_STATUSES, VALIDATION_STATUSES, PROCESSING_STATUSES } from '../src/modules/datasets/dataset.validation.js';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';
import { serve, captureLogger } from '../tests/helpers/http.js';

test('Atlas: dataset indexes, reported inventory, APIs, readiness filters, and unchanged Study Areas', { timeout: 60000 }, async (t) => {
  const config = loadEnv();
  assert.ok(config.mongodbUri, 'Configure MONGODB_URI and seed the registry before this opt-in check.');
  const database = createDatabase({ uri: config.mongodbUri, logger: captureLogger() });
  t.after(() => database.stop());
  database.start();
  for (let attempt = 0; attempt < 150 && !database.isReady(); attempt += 1) await delay(100);
  assert.equal(database.isReady(), true, 'Atlas did not become ready.');
  const connection = database.getConnection();
  const Dataset = getDatasetModel(connection);
  const Asset = getDatasetAssetModel(connection);
  const StudyArea = getStudyAreaModel(connection);
  const county = await StudyArea.findOne({ countryCode: 'US', geoid: '19169', areaType: 'county' }).lean().maxTimeMS(5000);
  assert.ok(county, 'Seed Story County before testing its dataset coverage.');
  const assetsBefore = await Asset.countDocuments().maxTimeMS(5000);
  const datasets = await Dataset.find({ slug: { $in: DATASET_INVENTORY.map((entry) => entry.slug) } }).sort({ slug: 1 }).lean().maxTimeMS(5000);
  assert.equal(datasets.length, 8);
  assert.equal(new Set(datasets.map((entry) => entry.slug)).size, 8);
  assert.ok(datasets.every((entry) => !getReadiness(entry).ready), 'Current project reports must not be marked ready.');
  const summariesImported = datasets.find((entry) => entry.slug === 'nasa-modis-mod13q1-061').processedSummaryAvailability?.status === 'available';

  for (const Model of [Dataset, Asset]) {
    const indexes = await Model.listIndexes();
    for (const [key, options] of Model.schema.indexes()) {
      const actual = indexes.find((index) => index.name === options.name);
      assert.ok(actual, options.name);
      assert.deepEqual(actual.key, key);
      assert.equal(Boolean(actual.unique), Boolean(options.unique));
      assert.deepEqual(actual.partialFilterExpression, options.partialFilterExpression);
    }
    t.diagnostic(`${Model.collection.collectionName} actual indexes: ${JSON.stringify(indexes)}`);
  }
  const base = await serve(createApp({ config, database, logger: captureLogger() }), t);
  async function get(path, status = 200) {
    const response = await fetch(base + path);
    assert.equal(response.status, status, path);
    const body = await response.json();
    assert.equal(body.success, status === 200);
    return body.data;
  }
  const listing = await get('/api/v1/datasets?limit=3&page=1');
  assert.equal(listing.items.length, 3);
  assert.equal(listing.pagination.total, 8);
  assert.equal((await get('/api/v1/datasets?limit=3&page=3')).items.length, 2);
  for (const [query, expected] of [
    ['provider=NASA', 4], ['provider=USDA', 3], ['provider=USGS', 1], ['category=climate', 2],
    ['acquisitionStatus=request_completed', 1], ['acquisitionStatus=reported_available', 2],
    ['validationStatus=pending', summariesImported ? 7 : 8], ['processingStatus=not_started', summariesImported ? 7 : 8],
    ['validationStatus=validated', summariesImported ? 1 : 0], ['processingStatus=completed', summariesImported ? 1 : 0],
    ['readiness=ready', 0], ['readiness=not_ready', 8], ['readiness=failed', 0],
    ['search=MERRA', 1], ['search=%2E%2A', 0], ['isActive=false', 0],
  ]) assert.equal((await get(`/api/v1/datasets?${query}`)).pagination.total, expected, query);
  const modis = await get('/api/v1/datasets/nasa-modis-mod13q1-061');
  assert.equal(modis.acquisition.status, 'request_completed');
  assert.equal(modis.acquisition.reportedInventory.size.value, 252.81);
  assert.equal(modis.acquisition.reportedInventory.size.unit, 'MB');
  assert.equal(modis.validation.status, summariesImported ? 'validated' : 'pending');
  assert.equal(modis.processing.status, summariesImported ? 'completed' : 'not_started');
  if (summariesImported) {
    assert.equal(modis.processedSummaryAvailability.countyMaskApplied, false);
    assert.equal(modis.processedSummaryAvailability.exactCountyStatistics, false);
    assert.equal(modis.processedSummaryAvailability.countyCoverageStatus, 'unverified');
    assert.equal(modis.processedSummaryAvailability.recordCount16day, 207);
    assert.equal(modis.processedSummaryAvailability.recordCountMonthly, 108);
  }
  const power = await get('/api/v1/datasets/nasa-power-daily/coverage');
  assert.equal(power.temporalCoverage.timezone, 'UTC');
  assert.equal(power.temporalCoverage.status, 'reported');
  const merra = await get('/api/v1/datasets/nasa-merra2-m2tmnxflx-5-12-4');
  assert.equal(merra.version, '5.12.4');
  assert.equal(merra.temporalCoverage.start, '2008-06');
  assert.equal(merra.variables.find((variable) => variable.name === 'TSH').availabilityStatus, 'reported_absent');
  for (const { slug } of DATASET_INVENTORY) {
    const result = await get(`/api/v1/datasets/${slug}/assets`);
    const expected = summariesImported && slug === 'nasa-modis-mod13q1-061' ? 2 : 0;
    assert.equal(result.pagination.total, expected, 'Only the two approved processed MODIS CSVs may be registered.');
    if (expected) assert.ok(result.items.every((asset) => asset.assetType === 'processed' && asset.format === 'CSV'));
    else assert.deepEqual(result.items, []);
  }
  const coverage = await get(`/api/v1/study-areas/${county._id}/coverage`);
  assert.equal(coverage.items.length, 8);
  assert.ok(coverage.items.every((entry) => entry.availability.available === null && !entry.availability.analysisReady));
  assert.equal(coverage.items.find((entry) => entry.dataset.slug === 'nasa-merra2-m2tmnxflx-5-12-4').availability.status, 'unverified');
  assert.equal(coverage.items.find((entry) => entry.dataset.slug === 'nasa-modis-mod13q1-061').coverage.status, 'unknown');
  await get('/api/v1/datasets/no-such-dataset', 404);
  await get('/api/v1/datasets/no-such-dataset/assets', 404);
  await get('/api/v1/datasets?provider=invalid', 400);
  await get('/api/v1/study-areas/invalid/coverage', 400);
  await get('/api/v1/study-areas/000000000000000000000000/coverage', 404);

  // Synthetic lifecycle fixtures, never persisted or claimed as real dataset validation.
  // Actual MongoDB matching verifies filter parity without depending on a query emulation library.
  const combinations = [];
  for (const isActive of [true, false]) for (const acquisition of ACQUISITION_STATUSES) for (const validation of VALIDATION_STATUSES) for (const processing of PROCESSING_STATUSES) {
    combinations.push({ auditId: combinations.length, isActive, acquisition: { status: acquisition }, validation: { status: validation }, processing: { status: processing } });
  }
  for (const isActive of [true, false]) for (const readiness of ['ready', 'not_ready', 'failed']) {
    const actual = await connection.db.aggregate([
      { $documents: combinations }, { $match: parseDatasetQuery({ isActive: String(isActive), readiness }).filter },
      { $project: { _id: 0, auditId: 1 } },
    ], { maxTimeMS: 5000 }).toArray();
    const expected = combinations.filter((entry) => entry.isActive === isActive && getReadiness(entry).status === readiness).map(({ auditId }) => ({ auditId }));
    assert.deepEqual(actual, expected, `Readiness filter: ${isActive}/${readiness}`);
  }
  assert.equal(await Asset.countDocuments().maxTimeMS(5000), assetsBefore);
  assert.deepEqual(await StudyArea.findById(county._id).lean().maxTimeMS(5000), county);
  assert.deepEqual(await Dataset.find({ slug: { $in: DATASET_INVENTORY.map((entry) => entry.slug) } }).sort({ slug: 1 }).lean().maxTimeMS(5000), datasets);
});
