// Explicitly opt-in via npm run test:integration. This file is outside default test discovery.
import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { loadEnv } from '../src/config/env.js';
import { createDatabase } from '../src/config/database.js';
import { createApp } from '../src/app.js';
import { getStudyAreaModel } from '../src/modules/study-areas/study-area.model.js';
import { readStoryCountySeed } from '../scripts/seedStudyAreas.js';
import { serve, captureLogger } from '../tests/helpers/http.js';

test('Atlas: seeded county, indexes, HTTP endpoints, and read-only intersection checks', { timeout: 45000 }, async (t) => {
  const config = loadEnv();
  assert.ok(config.mongodbUri, 'Set MONGODB_URI before running the opt-in Atlas checks.');
  const database = createDatabase({ uri: config.mongodbUri, logger: captureLogger() });
  t.after(() => database.stop());
  database.start();
  for (let attempt = 0; attempt < 150 && !database.isReady(); attempt += 1) await delay(100);
  assert.equal(database.isReady(), true, 'Atlas connection did not become ready.');
  const Model = getStudyAreaModel(database.getConnection());
  const countyFilter = { countryCode: 'US', areaType: 'county', geoid: '19169' };
  assert.equal(await Model.countDocuments(countyFilter), 1, 'Seed must leave exactly one Story County record.');
  const county = await Model.findOne(countyFilter).lean();
  assert.equal(county.geometryStatus, 'official');
  assert.equal(county.geometrySource.vintage, '2026');
  const feature = await readStoryCountySeed();
  assert.deepEqual(county.geometry, feature.geometry);
  assert.equal(county.geometry.type, 'Polygon');
  assert.equal(county.geometry.coordinates[0].length, 1050);
  assert.deepEqual(county.geometry.coordinates[0][0], county.geometry.coordinates[0].at(-1));
  assert.equal(feature.properties.crs, 'EPSG:4326');
  assert.deepEqual(county.geometrySource, {
    ...feature.properties.geometrySource, retrievedAt: new Date(feature.properties.geometrySource.retrievedAt),
  });
  assert.deepEqual(county.metadata, { ...feature.properties.metadata, crs: 'EPSG:4326' });
  const indexes = await Model.listIndexes();
  assert.deepEqual(indexes.find((index) => index.name === 'study_area_geometry_2dsphere')?.key, { geometry: '2dsphere' });
  const slugIndex = indexes.find((index) => index.name === 'study_area_slug_unique');
  assert.equal(slugIndex?.unique, true);
  assert.deepEqual(slugIndex.key, { slug: 1 });
  const geoidIndex = indexes.find((index) => index.name === 'study_area_county_geoid_unique');
  assert.equal(geoidIndex?.unique, true);
  assert.deepEqual(geoidIndex.key, { countryCode: 1, geoid: 1 });
  assert.deepEqual(geoidIndex.partialFilterExpression, { areaType: 'county', geoid: { $type: 'string' } });
  assert.equal(await Model.countDocuments({ slug: 'story-county-iowa' }).maxTimeMS(5000), 1);
  t.diagnostic(`Actual Atlas indexes: ${JSON.stringify(indexes)}`);

  const base = await serve(createApp({ config, database, logger: captureLogger() }), t);
  const ready = await (await fetch(`${base}/health/ready`)).json();
  assert.equal(ready.data.database.name, database.getConnection().db.databaseName);
  const live = await fetch(`${base}/health/live`);
  assert.equal(live.status, 200);
  await live.arrayBuffer();

  const listing = await (await fetch(`${base}/api/v1/study-areas?geoid=19169&limit=1`)).json();
  assert.equal(listing.data.pagination.total, 1);
  assert.equal(listing.data.items[0].geometry, undefined);
  for (const path of ['/api/v1/study-areas', '/api/v1/study-areas/']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.json()).data.items.some((area) => area._id === String(county._id)), path);
  }
  const filtered = await (await fetch(`${base}/api/v1/study-areas?areaType=county&geoid=19169&page=1&limit=1`)).json();
  assert.deepEqual(filtered.data.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
  const nextPage = await (await fetch(`${base}/api/v1/study-areas?areaType=county&geoid=19169&page=2&limit=1`)).json();
  assert.deepEqual(nextPage.data.items, []);
  assert.equal(nextPage.data.pagination.total, 1);
  const noMatch = await (await fetch(`${base}/api/v1/study-areas?areaType=county&geoid=00000`)).json();
  assert.deepEqual(noMatch.data.items, []);
  assert.equal(noMatch.data.pagination.total, 0);
  const withGeometry = await (await fetch(`${base}/api/v1/study-areas?geoid=19169&includeGeometry=true`)).json();
  assert.equal(withGeometry.data.items[0].geometry.type, feature.geometry.type);
  const detail = await (await fetch(`${base}/api/v1/study-areas/${county._id}`)).json();
  assert.deepEqual(detail.data.geometry.coordinates, feature.geometry.coordinates);
  const missing = await fetch(`${base}/api/v1/study-areas/000000000000000000000000`);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  for (const path of ['/api/v1/study-areas/invalid-id', '/api/v1/study-areas?limit=101']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).success, false);
  }

  const countBefore = await Model.countDocuments();
  const box = (longitude, latitude, radius) => ({ type: 'Polygon', coordinates: [[
    [longitude - radius, latitude - radius], [longitude + radius, latitude - radius],
    [longitude + radius, latitude + radius], [longitude - radius, latitude + radius],
    [longitude - radius, latitude - radius],
  ]] });
  const interiorLongitude = Number(feature.properties.metadata.sourceRecord.INTPTLON);
  const interiorLatitude = Number(feature.properties.metadata.sourceRecord.INTPTLAT);
  assert.ok(Number.isFinite(interiorLongitude) && Number.isFinite(interiorLatitude));
  const easternmost = feature.geometry.coordinates.flat().reduce((east, point) => point[0] > east[0] ? point : east);
  // Synthetic fixtures derived from the county's Census internal point and an actual boundary vertex.
  // These exist only in test memory and are never persisted or labeled as official boundaries.
  const fixtures = [
    { label: 'inside', geometry: box(interiorLongitude, interiorLatitude, 0.001), intersects: true },
    { label: 'outside', geometry: box(0, 0, 0.01), intersects: false },
    { label: 'boundary-crossing', geometry: box(easternmost[0], easternmost[1], 0.01), intersects: true },
  ];
  // Independently classify fixture placement without storing test documents. This is audit-only;
  // the public API still performs intersection only and never claims full containment.
  const withinCounty = await database.getConnection().db.aggregate([
    { $documents: fixtures.map(({ label, geometry }) => ({ label, geometry })) },
    { $match: { geometry: { $geoWithin: { $geometry: feature.geometry } } } },
    { $project: { _id: 0, label: 1 } },
  ], { maxTimeMS: 5000 }).toArray();
  assert.deepEqual(withinCounty, [{ label: 'inside' }]);
  for (const { label, geometry, intersects } of [...fixtures, { label: 'county-itself', geometry: feature.geometry, intersects: true }]) {
    const response = await fetch(`${base}/api/v1/areas/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.valid, true);
    assert.equal(body.data.pilotIntersection.status, 'evaluated');
    assert.equal(body.data.pilotIntersection.intersects, intersects, label);
    assert.equal(body.data.pilotIntersection.fullContainment, 'not_evaluated');
    t.diagnostic(`${label}: intersects=${body.data.pilotIntersection.intersects}; API fullContainment=${body.data.pilotIntersection.fullContainment}`);
  }
  const invalidGeometry = await fetch(`${base}/api/v1/areas/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry: { type: 'Polygon', coordinates: [] } }),
  });
  assert.equal(invalidGeometry.status, 200);
  const invalidBody = await invalidGeometry.json();
  assert.equal(invalidBody.data.valid, false);
  assert.ok(invalidBody.data.validationErrors.length > 0);
  assert.equal(invalidBody.data.pilotIntersection.reason, 'STRUCTURAL_VALIDATION_FAILED');
  assert.equal(await Model.countDocuments(), countBefore, 'Validation endpoint must never persist submitted geometry.');
  const afterValidation = await Model.findById(county._id).lean().maxTimeMS(5000);
  assert.deepEqual(afterValidation, county, 'Read-only API checks must preserve the complete stored county.');
});
