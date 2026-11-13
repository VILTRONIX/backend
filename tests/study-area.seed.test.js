import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { readStoryCountySeed, seedStoryCounty } from '../scripts/seedStudyAreas.js';
import { validateGeometry } from '../src/modules/study-areas/study-area.validation.js';
import { getStudyAreaModel, studyAreaSchema } from '../src/modules/study-areas/study-area.model.js';

test('checked-in official Census seed validates and matches the model without connecting', async (t) => {
  const feature = await readStoryCountySeed();
  assert.equal(feature.properties.geoid, '19169');
  assert.equal(feature.properties.geometrySource.vintage, '2026');
  assert.equal(validateGeometry(feature.geometry).valid, true);
  assert.match(feature.properties.metadata.archiveSha256, /^[a-f0-9]{64}$/);
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const { crs, ...properties } = feature.properties;
  await new (getStudyAreaModel(connection))({ ...properties, geometry: feature.geometry }).validate();
});

test('seed loader fails helpfully on missing files and rejects invalid or mislabeled data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'terrapulse-seed-test-'));
  const file = join(directory, 'input.geojson');
  t.after(async () => { await unlink(file).catch(() => {}); await rmdir(directory); });
  await assert.rejects(readStoryCountySeed(file), /Official GeoJSON is missing/);
  await writeFile(file, '{bad json');
  await assert.rejects(readStoryCountySeed(file), /not valid JSON/);
  const feature = await readStoryCountySeed();
  feature.properties.geometryStatus = 'illustrative';
  await writeFile(file, JSON.stringify(feature));
  await assert.rejects(readStoryCountySeed(file), /official EPSG:4326 Story County/);
  feature.properties.geometryStatus = 'official';
  feature.geometry.coordinates = [];
  await writeFile(file, JSON.stringify(feature));
  await assert.rejects(readStoryCountySeed(file), /Seed geometry is invalid/);
});

test('seed success requires full provenance, actual index definitions, and exactly one county', async (t) => {
  const feature = await readStoryCountySeed();
  const connection = mongoose.createConnection();
  t.after(() => connection.close());
  const Model = getStudyAreaModel(connection);
  const source = { ...feature.properties.geometrySource, retrievedAt: new Date(feature.properties.geometrySource.retrievedAt) };
  const goodStored = {
    _id: new mongoose.Types.ObjectId(), geometry: feature.geometry, geometrySource: source,
    metadata: { ...feature.properties.metadata, crs: 'EPSG:4326' },
  };
  const goodIndexes = studyAreaSchema.indexes().map(([key, options]) => ({ key, ...options }));
  let stored = goodStored;
  let indexes = goodIndexes;
  let count = 1;
  Model.createCollection = async () => {};
  Model.createIndexes = async () => {};
  Model.findOneAndUpdate = () => ({ maxTimeMS: async () => ({ _id: goodStored._id }) });
  Model.findById = () => ({ lean: () => ({ maxTimeMS: async () => stored }) });
  Model.listIndexes = async () => indexes;
  Model.countDocuments = () => ({ maxTimeMS: async () => count });

  await seedStoryCounty(Model, feature);
  for (const change of ['source', 'metadata', 'slug-index', 'county-index', 'count']) {
    stored = structuredClone(goodStored);
    indexes = structuredClone(goodIndexes);
    count = 1;
    if (change === 'source') stored.geometrySource.sourceIdentifier = '00000';
    if (change === 'metadata') stored.metadata.archiveSha256 = 'changed';
    if (change === 'slug-index') indexes.find((index) => index.key.slug).unique = false;
    if (change === 'county-index') indexes.find((index) => index.key.geoid).partialFilterExpression = { areaType: 'user_drawn' };
    if (change === 'count') count = 2;
    await assert.rejects(seedStoryCounty(Model, feature), /Seed verification failed/, change);
  }
});
