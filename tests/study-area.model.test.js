import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { getStudyAreaModel, studyAreaSchema } from '../src/modules/study-areas/study-area.model.js';

const baseArea = () => ({
  name: 'Unit test area', slug: 'unit-test-area', areaType: 'user_drawn',
  country: 'United States', countryCode: 'US', geometryStatus: 'pending',
});

test('model uses the provided connection and validates without a live MongoDB', async (t) => {
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getStudyAreaModel(connection);
  assert.equal(Model.db, connection);
  assert.equal(getStudyAreaModel(connection), Model);
  await new Model(baseArea()).validate();
  await assert.rejects(new Model({ ...baseArea(), areaType: 'county' }).validate(), /geoid/);
  await assert.rejects(new Model({ ...baseArea(), geometryStatus: 'official' }).validate(), /geometry/);
  await assert.rejects(new Model({ ...baseArea(), areaType: 'illustrative_demo', geometryStatus: 'official' }).validate(), /Illustrative demo/);
  await assert.rejects(new Model({ ...baseArea(), geometry: { type: 'Polygon', coordinates: [] } }).validate(), /Geometry failed/);
});

test('schema defines unique slug, partial county identity, and 2dsphere indexes once', () => {
  const indexes = studyAreaSchema.indexes();
  assert.equal(indexes.length, 3);
  assert.ok(indexes.some(([keys, options]) => keys.slug === 1 && options.unique));
  assert.ok(indexes.some(([keys, options]) => keys.geoid === 1 && keys.countryCode === 1 && options.unique && options.partialFilterExpression.areaType === 'county'));
  assert.ok(indexes.some(([keys]) => keys.geometry === '2dsphere'));
});
