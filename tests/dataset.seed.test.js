import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { seedDatasets } from '../scripts/seedDatasets.js';
import { DATASET_INVENTORY } from '../data/seed/datasets.js';
import { getDatasetModel } from '../src/modules/datasets/dataset.model.js';

async function memoryRegistry(t) {
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getDatasetModel(connection);
  const records = new Map();
  let writes = 0;
  Model.findOne = ({ slug }) => ({ lean: () => ({ maxTimeMS: async () => records.has(slug) ? structuredClone(records.get(slug)) : null }) });
  Model.updateOne = ({ slug }, update, options) => ({ maxTimeMS: async () => {
    assert.equal(options.upsert, true);
    writes += 1;
    const current = records.get(slug);
    if (current) records.set(slug, { ...current, ...structuredClone(update.$set) });
    else records.set(slug, { _id: String(new mongoose.Types.ObjectId()), ...structuredClone(update.$setOnInsert), ...structuredClone(update.$set) });
    return { upsertedCount: current ? 0 : 1, modifiedCount: current ? 1 : 0 };
  } });
  return { Model, records, writes: () => writes };
}

test('seed creates all eight datasets and a second run is unchanged without duplicate identities', async (t) => {
  const { Model, records, writes } = await memoryRegistry(t);
  assert.deepEqual(await seedDatasets(Model), { created: 8, updated: 0, unchanged: 0 });
  const first = structuredClone([...records]);
  assert.deepEqual(await seedDatasets(Model), { created: 0, updated: 0, unchanged: 8 });
  assert.deepEqual([...records], first);
  assert.equal(records.size, 8);
  assert.equal(writes(), 8);
});

test('descriptive updates preserve manually maintained lifecycle states, units, coverage, and active flags', async (t) => {
  const { Model, records } = await memoryRegistry(t);
  await seedDatasets(Model);
  const slug = DATASET_INVENTORY[0].slug;
  const record = records.get(slug);
  // Test-only state changes in memory; these are never asserted as real source validation in Atlas.
  record.validation = { status: 'validated', evidenceReference: 'private-test-evidence' };
  record.processing = { status: 'completed' };
  record.acquisition.status = 'downloaded';
  record.isActive = false;
  record.variables[0].unit = 'test-unit';
  record.variables[0].availabilityStatus = 'verified';
  record.spatialCoverage.status = 'verified';
  record.name = 'outdated descriptive title';
  const protectedFields = structuredClone({ acquisition: record.acquisition, validation: record.validation, processing: record.processing, variables: record.variables, spatialCoverage: record.spatialCoverage });
  assert.deepEqual(await seedDatasets(Model), { created: 0, updated: 1, unchanged: 7 });
  const after = records.get(slug);
  assert.equal(after.name, DATASET_INVENTORY[0].name);
  assert.equal(after.isActive, false);
  for (const [key, value] of Object.entries(protectedFields)) assert.deepEqual(after[key], value);
});

test('invalid or duplicate seed inventory fails before any dataset writes', async (t) => {
  const { Model, writes } = await memoryRegistry(t);
  await assert.rejects(seedDatasets(Model, [DATASET_INVENTORY[0], DATASET_INVENTORY[0]]), /duplicate slugs/);
  await assert.rejects(seedDatasets(Model, [DATASET_INVENTORY[0], { ...DATASET_INVENTORY[0], slug: 'other-slug' }]), /duplicate provider\/product\/version/);
  await assert.rejects(seedDatasets(Model, [{ ...DATASET_INVENTORY[0], provider: 'invalid' }]), { name: 'ValidationError' });
  assert.equal(writes(), 0);
});
