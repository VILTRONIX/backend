import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDatasetQuery, parseAssetQuery, getReadiness, validateSlug, ACQUISITION_STATUSES, VALIDATION_STATUSES, PROCESSING_STATUSES } from '../src/modules/datasets/dataset.validation.js';

test('readiness requires download, validation, processing completion, and an active dataset', () => {
  const record = { isActive: true, acquisition: { status: 'request_completed' }, validation: { status: 'pending' }, processing: { status: 'not_started' } };
  assert.equal(getReadiness(record).ready, false);
  record.acquisition.status = 'downloaded';
  assert.equal(getReadiness(record).ready, false);
  record.validation.status = 'validated';
  record.processing.status = 'completed';
  assert.equal(getReadiness(record).status, 'ready');
  record.isActive = false;
  assert.equal(getReadiness(record).status, 'not_ready');
  record.validation.status = 'failed';
  assert.equal(getReadiness(record).status, 'failed');
});

test('every incomplete or failed lifecycle combination remains unready', () => {
  for (const isActive of [true, false]) for (const acquisition of ACQUISITION_STATUSES) for (const validation of VALIDATION_STATUSES) for (const processing of PROCESSING_STATUSES) {
    const record = { isActive, acquisition: { status: acquisition }, validation: { status: validation }, processing: { status: processing } };
    const expected = isActive && acquisition === 'downloaded' && validation === 'validated' && processing === 'completed';
    assert.equal(getReadiness(record).ready, expected, JSON.stringify(record));
  }
});

test('dataset queries validate filters, pagination, and escaped literal search', () => {
  const options = parseDatasetQuery({ provider: 'NASA', category: 'climate', acquisitionStatus: 'reported_available', validationStatus: 'pending', processingStatus: 'not_started', page: '2', limit: '3', search: 'MERRA.*' });
  assert.equal(options.page, 2);
  assert.equal(options.limit, 3);
  assert.equal(options.filter['acquisition.status'], 'reported_available');
  assert.equal(options.filter.provider, 'NASA');
  assert.equal(options.filter.category, 'climate');
  assert.equal(options.filter.$or[0].name.$regex, 'MERRA\\.\\*');
  assert.equal(new RegExp(options.filter.$or[0].name.$regex, 'i').test('MERRA-anything'), false);
});

for (const query of [
  { page: '0' }, { limit: '101' }, { page: ['1', '2'] }, { provider: 'nasa' }, { category: 'other' },
  { acquisitionStatus: 'complete' }, { validationStatus: 'unknown' }, { processingStatus: 'done' }, { readiness: 'yes' },
  { isActive: 'yes' }, { search: { $ne: null } }, { search: ' ' }, { search: 'x'.repeat(101) }, { $where: 'code' },
]) test(`rejects invalid dataset query ${JSON.stringify(query)}`, () => assert.throws(() => parseDatasetQuery(query), (error) => error.status === 400));

test('slugs and asset filters are bounded and accept only supported values', () => {
  assert.equal(validateSlug('nasa-power-daily'), 'nasa-power-daily');
  for (const slug of ['UPPER', '../private', 'x'.repeat(121)]) assert.throws(() => validateSlug(slug));
  assert.deepEqual(parseAssetQuery({ assetType: 'processed', limit: '2' }), { page: 1, limit: 2, filter: { assetType: 'processed' } });
  assert.throws(() => parseAssetQuery({ assetType: 'invented' }));
  assert.throws(() => parseAssetQuery({ storageUri: 'private' }));
});
