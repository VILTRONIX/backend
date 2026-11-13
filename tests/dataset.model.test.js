import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';
import { datasetSchema, getDatasetModel } from '../src/modules/datasets/dataset.model.js';
import { datasetAssetSchema, getDatasetAssetModel } from '../src/modules/datasets/dataset-asset.model.js';
import { getReadiness } from '../src/modules/datasets/dataset.validation.js';

test('all eight reported inventory entries validate without implying readiness or fabricated assets', async (t) => {
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getDatasetModel(connection);
  assert.equal(DATASET_INVENTORY.length, 8);
  assert.equal(new Set(DATASET_INVENTORY.map((entry) => entry.slug)).size, 8);
  for (const entry of DATASET_INVENTORY) {
    const document = new Model(entry);
    await document.validate();
    assert.equal(getReadiness(document).ready, false);
    assert.equal(document.validation.status, 'pending');
    assert.equal(document.processing.status, 'not_started');
    assert.ok(document.variables.every((variable) => variable.unit === null));
    assert.equal(document.source.inventoryBasis, 'project_report');
  }
  const merra = new Model(DATASET_INVENTORY[1]);
  assert.equal(merra.temporalCoverage.start, '2008-06');
  assert.equal(merra.temporalCoverage.precision, 'month');
  assert.equal(merra.variables.find((variable) => variable.name === 'TSH').availabilityStatus, 'reported_absent');
  assert.match(merra.variables.find((variable) => variable.name === 'Var_TSH').description, /never be substituted/);
  assert.equal(new Model(DATASET_INVENTORY[2]).temporalCoverage.timezone, 'UTC');
  const smap = new Model(DATASET_INVENTORY[3]);
  assert.equal(smap.productId, null);
  assert.equal(smap.temporalCoverage.start, null);
  assert.equal(smap.acquisition.reportedInventory.fileCount, null);
  assert.equal(Model.db, connection);
});

test('dataset schema rejects invalid enums, variables, dates, precision, and unsubstantiated verified coverage', async (t) => {
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getDatasetModel(connection);
  for (const change of [
    { provider: 'other' }, { category: 'other' }, { acquisition: { status: 'completed' } },
    { variables: [{ name: 'X', displayName: 'X' }, { name: 'X', displayName: 'X' }] },
    { temporalCoverage: { status: 'reported', start: '2025-02-30', end: '2025-12-31', precision: 'day' } },
    { temporalCoverage: { status: 'reported', start: '2025-12', end: '2025-01', precision: 'month' } },
    { temporalCoverage: { status: 'reported', start: '2025-01', end: '2025-12', precision: 'day' } },
    { spatialCoverage: { status: 'verified' } },
    { spatialCoverage: { areas: [{ countryCode: 'US', geoid: '19169', status: 'verified' }] } },
  ]) await assert.rejects(new Model({ ...DATASET_INVENTORY[0], ...change }).validate(), { name: 'ValidationError' });
});

test('asset model requires actual discovery metadata and keeps raw/processed roles separate', async (t) => {
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getDatasetAssetModel(connection);
  const entry = {
    datasetId: new mongoose.Types.ObjectId(), assetKey: 'test-only-file', assetType: 'raw',
    fileName: 'test-only.csv', format: 'CSV', storageType: 'local', storageUri: 'C:/private/test-only.csv', discoveredAt: new Date(),
  };
  // Schema-only fixture; it is never saved or represented as a real source asset.
  const document = new Model(entry);
  await document.validate();
  assert.equal(document.sizeBytes, null);
  assert.equal(document.checksum, null);
  assert.equal(document.validationStatus, 'pending');
  for (const change of [
    { discoveredAt: null }, { fileName: 'C:\\private\\test.csv' }, { sizeBytes: -1 }, { sizeBytes: 1.5 },
    { assetType: 'other' }, { checksum: 'bad', checksumAlgorithm: 'sha256' }, { metadata: { content: 'x'.repeat(17000) } },
  ]) await assert.rejects(new Model({ ...entry, ...change }).validate(), { name: 'ValidationError' });
  assert.equal(datasetAssetSchema.path('storageUri').options.select, false);
  assert.equal(datasetAssetSchema.path('metadata').options.select, false);
});

test('dataset and asset schemas define required identity and query indexes exactly once', () => {
  const indexes = datasetSchema.indexes();
  assert.equal(indexes.length, 4);
  assert.ok(indexes.some(([key, options]) => key.slug === 1 && options.unique));
  assert.ok(indexes.some(([key, options]) => key.productId === 1 && key.version === 1 && options.unique && options.partialFilterExpression.productId.$type === 'string'));
  assert.ok(indexes.some(([key]) => key.provider === 1 && key.category === 1));
  assert.ok(datasetAssetSchema.indexes().some(([key, options]) => key.assetKey === 1 && options.unique));
});
