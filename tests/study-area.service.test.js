import assert from 'node:assert/strict';
import test from 'node:test';
import { createStudyAreaService } from '../src/modules/study-areas/study-area.service.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const database = { isReady: () => true };
const query = (value) => ({ select() { return this; }, maxTimeMS() { return this; }, lean: async () => value });

test('pilot intersection uses MongoDB geoIntersects and explicitly leaves containment unevaluated', async () => {
  let filter;
  const service = createStudyAreaService({ database, model: {
    findOne: () => query({ _id: 'county-id' }),
    exists: (value) => { filter = value; return { maxTimeMS: async () => ({ _id: 'county-id' }) }; },
  } });
  const result = await service.validate(geometry);
  assert.equal(result.valid, true);
  assert.equal(result.pilotIntersection.intersects, true);
  assert.equal(result.pilotIntersection.fullContainment, 'not_evaluated');
  assert.deepEqual(filter.geometry.$geoIntersects.$geometry, geometry);
  assert.equal(filter._id, 'county-id');
});

test('missing official county is unavailable rather than an invented negative intersection', async () => {
  const service = createStudyAreaService({ database, model: { findOne: () => query(null) } });
  const result = await service.validate(geometry);
  assert.equal(result.pilotIntersection.intersects, null);
  assert.equal(result.pilotIntersection.reason, 'OFFICIAL_COUNTY_NOT_AVAILABLE');
});

test('service returns 404 for a missing stored area', async () => {
  const service = createStudyAreaService({ database, model: { findOne: () => query(null) } });
  await assert.rejects(service.getById('507f1f77bcf86cd799439011'), (error) => error.status === 404);
});

test('MongoDB topology rejection does not masquerade as a completed intersection test', async () => {
  const service = createStudyAreaService({ database, model: {
    findOne: () => query({ _id: 'county-id' }),
    exists: () => ({ maxTimeMS: async () => { throw Object.assign(new Error('private driver details'), { name: 'MongoServerError', code: 2 }); } }),
  } });
  const result = await service.validate(geometry);
  assert.equal(result.pilotIntersection.status, 'unavailable');
  assert.equal(result.pilotIntersection.reason, 'GEOSPATIAL_QUERY_REJECTED');
  assert.doesNotMatch(JSON.stringify(result), /private driver details/);
});

test('listing omits geometry by default and uses a deterministic bounded page', async () => {
  let projection, offset, pageSize;
  const cursor = {
    select(value) { projection = value; return this; }, sort() { return this; },
    skip(value) { offset = value; return this; }, limit(value) { pageSize = value; return this; },
    maxTimeMS() { return this; }, lean: async () => [{ name: 'Area' }],
  };
  const service = createStudyAreaService({ database, model: {
    find: () => cursor, countDocuments: () => ({ maxTimeMS: async () => 3 }),
  } });
  const result = await service.list({ filter: { isActive: true }, page: 2, limit: 2, includeGeometry: false });
  assert.equal(projection, '-geometry -__v');
  assert.equal(offset, 2);
  assert.equal(pageSize, 2);
  assert.equal(result.pagination.totalPages, 2);
  await service.list({ filter: { isActive: true }, page: 1, limit: 2, includeGeometry: true });
  assert.equal(projection, '-__v');
});
