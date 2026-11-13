import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';
import { createVegetationService, formatSummary, publicObservation } from '../src/modules/vegetation/vegetation.service.js';
import { parseVegetationQuery, validPeriodKey } from '../src/modules/vegetation/vegetation.validation.js';
import { APPROVED_SOURCES, SPATIAL_PROVENANCE, PROCESSING_METADATA } from '../src/modules/vegetation/vegetation.constants.js';
import { serve, captureLogger } from './helpers/http.js';

const datasetId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
const areaId = new mongoose.Types.ObjectId('6af71070cca3d14ecfec0aed');
const cursor = (value) => ({
  select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return this; }, maxTimeMS() { return this; },
  then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
});
async function setup(t, overrides = {}, ready = true) {
  const database = { isReady: () => ready, getStatus: () => ({ ready }) };
  const observation = {
    periodKey: '2019-02', month: '2019-02', resolution: 'monthly', ndviMean: null, eviMean: null,
    missingDataStatus: 'no_valid_pixels', sourceFile: APPROVED_SOURCES.monthly.fileName, ...SPATIAL_PROVENANCE,
  };
  let seen;
  const models = {
    datasetModel: { findOne: () => cursor({ ...DATASET_INVENTORY[0], _id: datasetId, processedSummaryAvailability: { status: 'available' } }) },
    studyAreaModel: { findOne: () => cursor({ _id: areaId, name: 'Story County', geoid: '19169' }) },
    assetModel: { find: () => cursor([{ fileName: APPROVED_SOURCES['16day'].fileName }, { fileName: APPROVED_SOURCES.monthly.fileName }]) },
    observationModel: {
      find: (filter) => { seen = filter; return cursor([observation]); }, countDocuments: () => cursor(1), findOne: () => cursor(observation),
      aggregate: () => ({ option: async () => [{ recordCount: 2, validObservationCount: 0, firstPeriod: '2019-02', lastPeriod: '2021-01', missingPeriods: ['2019-02', '2021-01'], ndviCount: 0, eviCount: 0, ndviAverage: null, eviAverage: null, ndviMinimum: null, eviMinimum: null, ndviMaximum: null, eviMaximum: null, totalPixelObservations: 40, ndviValidPixels: 0, eviValidPixels: 0 }] }),
    }, ...overrides,
  };
  const vegetationService = createVegetationService({ database, ...models });
  const base = await serve(createApp({ config: parseEnv({}), database, vegetationService, logger: captureLogger() }), t);
  return { base, seen: () => seen };
}

test('vegetation listing applies resolution, inclusive period/area filters, and returns bounding-box disclosure', async (t) => {
  const { base, seen } = await setup(t);
  const response = await fetch(`${base}/api/v1/observations/vegetation?resolution=monthly&areaId=${areaId}&geoid=19169&startDate=2019-02&endDate=2021-01&page=1&limit=5`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(body.data.pagination.limit, 5);
  assert.deepEqual(seen().periodKey, { $gte: '2019-02', $lte: '2021-01' });
  assert.equal(String(seen().studyAreaId), String(areaId));
  assert.equal(seen().resolution, 'monthly');
  assert.equal(body.data.items[0].ndviMean, null);
  assert.equal(body.data.metadata.nativeSpatialResolutionMeters, 250);
  for (const [field, value] of Object.entries(SPATIAL_PROVENANCE)) assert.equal(body.data.metadata[field], value);
  assert.equal(body.data.metadata.datasetReadiness.ready, false);
  assert.equal(body.data.metadata.rasterRenderingSupported, false);
});

test('summary requires a resolution and keeps all-null averages/extrema null', async (t) => {
  const { base } = await setup(t);
  assert.equal((await fetch(`${base}/api/v1/observations/vegetation/summary`)).status, 400);
  const response = await fetch(`${base}/api/v1/observations/vegetation/summary?resolution=monthly`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.missingObservationCount, 2);
  assert.equal(body.data.statistics.ndvi.averagePeriodMean, null);
  assert.equal(body.data.statistics.evi.minimumPeriodMean, null);
  assert.match(body.data.statisticScope, /period_means_not_pixel_extrema/);
  assert.deepEqual(body.data.missingPeriods, ['2019-02', '2021-01']);
  assert.equal(formatSummary(undefined, '16day').statistics.ndvi.averagePeriodMean, null);
  assert.equal(formatSummary(undefined, '16day').pixelCoverage.ndviValidPixelPercentage, null);
});

test('lookup preserves monthly keys, validates date format, and returns 404 for a missing period', async (t) => {
  const { base } = await setup(t);
  const monthly = await fetch(`${base}/api/v1/observations/vegetation/2019-02?resolution=monthly`);
  assert.equal(monthly.status, 200);
  const body = await monthly.json();
  assert.equal(body.data.observation.month, '2019-02');
  assert.equal(body.data.observation.missingDataStatus, 'no_valid_pixels');
  assert.equal((await fetch(`${base}/api/v1/observations/vegetation/2019-02-30`)).status, 400);
  assert.equal((await fetch(`${base}/api/v1/observations/vegetation/2019-02?resolution=16day`)).status, 400);
  const missing = await setup(t, { observationModel: { findOne: () => cursor(null) } });
  const response = await fetch(`${missing.base}/api/v1/observations/vegetation/2020-01-01`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'VEGETATION_OBSERVATION_NOT_FOUND');
});

test('query validation rejects invalid dates, mixed resolutions, arrays/operators, and unbounded pagination', () => {
  assert.equal(parseVegetationQuery({}).resolution, '16day');
  assert.equal(validPeriodKey('2020-02-29', '16day'), true);
  assert.equal(validPeriodKey('2019-02-29', '16day'), false);
  for (const query of [{ resolution: 'all' }, { resolution: ['16day', 'monthly'] }, { areaId: 'bad' }, { geoid: 'Iowa' }, { startDate: '2019-02-30' }, { resolution: 'monthly', startDate: '2019-02-01' }, { startDate: '2020-01-01', endDate: '2019-01-01' }, { page: '0' }, { limit: '101' }, { $where: 'code' }]) assert.throws(() => parseVegetationQuery(query), (error) => error.status === 400);
});

test('public observations do not expose private paths, content hashes, or unrecognized processing metadata', () => {
  const result = publicObservation({ sourceFile: 'C:\\private\\source.csv', contentHash: 'private', processingMetadata: { filePath: '/private/source.csv' } });
  assert.equal(result.sourceFile, null);
  assert.equal(result.contentHash, undefined);
  assert.deepEqual(result.processingMetadata, PROCESSING_METADATA);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('database outage returns a sanitized 503 for vegetation endpoints', async (t) => {
  const { base } = await setup(t, {}, false);
  const response = await fetch(`${base}/api/v1/observations/vegetation`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'DATABASE_UNAVAILABLE');
});
