import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createStudyAreaService } from '../src/modules/study-areas/study-area.service.js';
import { AppError } from '../src/utils/appError.js';
import { serve, captureLogger } from './helpers/http.js';

const geometry = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
const id = '507f1f77bcf86cd799439011';

async function setup(t, service, ready = true) {
  const database = { isReady: () => ready, getStatus: () => ({ ready, name: ready ? 'terrapulse' : null }) };
  const app = createApp({ config: parseEnv({}), database, logger: captureLogger(), studyAreaService: service });
  return serve(app, t);
}

test('list endpoint passes only validated filters and returns pagination in the existing envelope', async (t) => {
  let options;
  const base = await setup(t, {
    list: async (query) => { options = query; return { items: [{ _id: id, name: 'Test area' }], pagination: { page: 2, limit: 5, total: 6, totalPages: 2 } }; },
  });
  const response = await fetch(`${base}/api/v1/study-areas?page=2&limit=5&areaType=county&geoid=19169&includeGeometry=true`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(body.data.items.length, 1);
  assert.equal(body.data.pagination.page, 2);
  assert.deepEqual(options.filter, { isActive: true, areaType: 'county', geoid: '19169' });
  assert.equal(options.includeGeometry, true);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('list endpoint also accepts a trailing slash', async (t) => {
  const base = await setup(t, { list: async () => ({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }) });
  for (const path of ['/api/v1/study-areas', '/api/v1/study-areas/']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.deepEqual(body.data.items, []);
  }
});

test('detail endpoint includes geometry and missing study area returns 404', async (t) => {
  const base = await setup(t, {
    getById: async (areaId) => {
      if (areaId !== id) throw new AppError(404, 'STUDY_AREA_NOT_FOUND', 'Study area was not found.');
      return { _id: id, geometry };
    },
  });
  const found = await fetch(`${base}/api/v1/study-areas/${id}`);
  assert.equal(found.status, 200);
  assert.deepEqual((await found.json()).data.geometry, geometry);
  const missing = await fetch(`${base}/api/v1/study-areas/507f1f77bcf86cd799439012`);
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, 'STUDY_AREA_NOT_FOUND');
});

test('invalid ids and query operators return 400 before calling the service', async (t) => {
  const base = await setup(t, {});
  for (const path of ['/api/v1/study-areas/not-an-id', '/api/v1/study-areas?limit=101', '/api/v1/study-areas?geoid[$ne]=x', '/api/v1/study-areas?includeGeometry=yes', '/api/v1/study-areas?page=1&page=2']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 400, path);
    assert.equal((await response.json()).success, false);
  }
});

test('validation endpoint returns structural results even when the database is down and never writes', async (t) => {
  const database = { isReady: () => false };
  const service = createStudyAreaService({ database, model: new Proxy({}, { get: () => { throw new Error('Database must not be touched'); } }) });
  const base = await setup(t, service, false);
  const send = (body) => fetch(`${base}/api/v1/areas/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const response = await send({ geometry });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.data.valid, true);
  assert.equal(body.data.coordinateCount, 4);
  assert.equal(body.data.pilotIntersection.reason, 'DATABASE_UNAVAILABLE');
  assert.equal(body.data.pilotIntersection.fullContainment, 'not_evaluated');
  const invalid = await (await send({ geometry: { type: 'Polygon', coordinates: [] } })).json();
  assert.equal(invalid.data.valid, false);
  assert.ok(invalid.data.validationErrors.length > 0);
  assert.equal((await send({})).status, 400);
});

test('list and detail report database unavailability as 503', async (t) => {
  const base = await setup(t, undefined, false);
  for (const path of ['/api/v1/study-areas', `/api/v1/study-areas/${id}`]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'DATABASE_UNAVAILABLE');
  }
});

test('validation request body limit returns JSON 413', async (t) => {
  const base = await setup(t, {});
  const response = await fetch(`${base}/api/v1/areas/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ geometry, padding: 'x'.repeat(1100000) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE');
});
