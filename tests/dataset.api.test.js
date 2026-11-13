import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createDatasetService, areaAvailability, publicDataset, publicAsset } from '../src/modules/datasets/dataset.service.js';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';
import { serve, captureLogger } from './helpers/http.js';

const areaId = '6af71070cca3d14ecfec0aed';
const datasetId = '507f1f77bcf86cd799439011';
const record = () => ({ _id: datasetId, ...structuredClone(DATASET_INVENTORY[0]) });
const area = { _id: areaId, name: 'Story County', areaType: 'county', countryCode: 'US', geoid: '19169' };

function cursor(value) {
  return {
    select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, maxTimeMS() { return this; }, lean() { return this; },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}
async function setup(t, overrides = {}, ready = true) {
  const database = { isReady: () => ready, getStatus: () => ({ ready }) };
  const models = {
    datasetModel: { find: () => cursor([record()]), countDocuments: () => cursor(1), findOne: ({ slug }) => cursor(slug === DATASET_INVENTORY[0].slug ? record() : null) },
    assetModel: { find: () => cursor([]), countDocuments: () => cursor(0) },
    studyAreaModel: { findOne: ({ _id }) => cursor(_id === areaId ? area : null) },
    ...overrides,
  };
  const service = createDatasetService({ database, ...models });
  const app = createApp({ config: parseEnv({}), database, datasetService: service, logger: captureLogger() });
  return serve(app, t);
}

test('dataset listing returns the response envelope, pagination, provider/category/status filters, and derived readiness', async (t) => {
  let seenFilter;
  const model = {
    find: (filter) => { seenFilter = filter; return cursor([record()]); }, countDocuments: () => cursor(1),
  };
  const base = await setup(t, { datasetModel: model });
  const response = await fetch(`${base}/api/v1/datasets?provider=NASA&category=vegetation&acquisitionStatus=request_completed&validationStatus=pending&processingStatus=not_started&page=1&limit=2`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.deepEqual(body.data.pagination, { page: 1, limit: 2, total: 1, totalPages: 1 });
  assert.equal(body.data.items[0].readiness.status, 'not_ready');
  assert.equal(seenFilter.provider, 'NASA');
  assert.equal(seenFilter.category, 'vegetation');
  assert.equal(seenFilter['acquisition.status'], 'request_completed');
  assert.equal(seenFilter['validation.status'], 'pending');
  assert.equal(seenFilter['processing.status'], 'not_started');
});

test('dataset detail resolves slugs, reports missing records, and omits private evidence', async (t) => {
  const base = await setup(t);
  const response = await fetch(`${base}/api/v1/datasets/${DATASET_INVENTORY[0].slug}`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.productId, 'MOD13Q1.061');
  assert.equal(body.data.acquisition.status, 'request_completed');
  assert.equal(body.data.variables[0].unit, null);
  const missing = await fetch(`${base}/api/v1/datasets/no-such-dataset`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'DATASET_NOT_FOUND');
});

test('asset listing stays scoped to its dataset and does not expose local paths or internal metadata', async (t) => {
  let filter;
  const base = await setup(t, { assetModel: {
    find: (value) => { filter = value; return cursor([{
      datasetId, assetKey: 'schema-test-only', assetType: 'raw', fileName: 'test-only.csv', format: 'CSV',
      storageUri: 'C:\\private\\sensitive.csv', metadata: { localPath: '/private/sensitive.csv' },
    }]); }, countDocuments: () => cursor(1),
  } });
  const response = await fetch(`${base}/api/v1/datasets/${DATASET_INVENTORY[0].slug}/assets?assetType=raw`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(filter.datasetId, datasetId);
  assert.equal(filter.assetType, 'raw');
  assert.equal(body.data.items[0].fileName, 'test-only.csv');
  assert.doesNotMatch(JSON.stringify(body), /private|storageUri|localPath/);
  assert.equal(publicAsset({ fileName: 'C:\\private\\leak.csv' }).fileName, null);
});

test('empty asset inventories remain empty rather than inventing reported files', async (t) => {
  const base = await setup(t);
  const response = await fetch(`${base}/api/v1/datasets/${DATASET_INVENTORY[0].slug}/assets`);
  const body = await response.json();
  assert.deepEqual(body.data.items, []);
  assert.equal(body.data.pagination.total, 0);
});

test('dataset coverage distinguishes reported dates from unknown verified county coverage', async (t) => {
  const base = await setup(t);
  const response = await fetch(`${base}/api/v1/datasets/${DATASET_INVENTORY[0].slug}/coverage`);
  const body = await response.json();
  assert.equal(body.data.temporalCoverage.status, 'reported');
  assert.equal(body.data.temporalCoverage.start, '2017-01-01');
  assert.equal(body.data.spatialCoverage.status, 'reported');
  assert.equal(body.data.readiness.ready, false);
});

test('Story County coverage never infers local availability from global extent or dataset dates', async (t) => {
  const base = await setup(t, { datasetModel: { find: () => cursor(DATASET_INVENTORY), countDocuments: () => cursor(8) } });
  const response = await fetch(`${base}/api/v1/study-areas/${areaId}/coverage`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.studyArea.geoid, '19169');
  assert.equal(body.data.items.length, 8);
  assert.ok(body.data.items.every((item) => item.availability.available === null && item.availability.analysisReady === false));
  const modis = body.data.items.find((item) => item.dataset.slug === DATASET_INVENTORY[0].slug);
  assert.equal(modis.coverage.status, 'unknown');
  assert.equal(modis.coverage.temporalCoverage.start, null);
  assert.equal(modis.datasetTemporalCoverage.status, 'reported');
  const merra = body.data.items.find((item) => item.dataset.slug === DATASET_INVENTORY[1].slug);
  assert.equal(merra.coverage.status, 'reported');
  assert.equal(merra.availability.status, 'unverified');
  const missing = await fetch(`${base}/api/v1/study-areas/000000000000000000000000/coverage`);
  assert.equal(missing.status, 404);
});

test('only an explicit area claim can establish availability; private evidence never leaks', () => {
  const dataset = record();
  dataset.acquisition.status = 'downloaded';
  dataset.validation.status = 'validated';
  dataset.processing.status = 'completed';
  dataset.spatialCoverage.areas = [{ countryCode: 'US', geoid: '19169', status: 'verified', evidenceReference: '/private/evidence' }];
  assert.equal(areaAvailability(dataset, area).availability.available, true);
  dataset.spatialCoverage.areas[0].status = 'unavailable';
  assert.equal(areaAvailability(dataset, area).availability.available, false);
  dataset.spatialCoverage.areas[0].studyAreaId = '000000000000000000000000';
  assert.equal(areaAvailability(dataset, area).coverage.status, 'unknown');
  dataset.validation.evidenceReference = '/private/check';
  assert.doesNotMatch(JSON.stringify(publicDataset(dataset)), /evidenceReference|\/private/);
});

test('invalid dataset and asset query parameters fail with 400', async (t) => {
  const base = await setup(t);
  for (const path of [
    '/api/v1/datasets?provider=other', '/api/v1/datasets?page=0', '/api/v1/datasets?limit=101',
    '/api/v1/datasets?provider=NASA&provider=USDA', '/api/v1/datasets?readiness=complete',
    '/api/v1/datasets?search[$ne]=x', '/api/v1/datasets/INVALID',
    `/api/v1/datasets/${DATASET_INVENTORY[0].slug}/assets?assetType=imaginary`,
    '/api/v1/study-areas/not-an-id/coverage',
  ]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).success, false);
  }
});

test('registry APIs return database-unavailable 503 while health liveness continues', async (t) => {
  const base = await setup(t, {}, false);
  const response = await fetch(`${base}/api/v1/datasets`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DATABASE_UNAVAILABLE');
  const live = await fetch(`${base}/health/live`);
  assert.equal(live.status, 200);
});
