import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGeometry, parseListQuery, MAX_GEOMETRY_BYTES, MAX_COORDINATES } from '../src/modules/study-areas/study-area.validation.js';

// Synthetic unit-test coordinates only; never used as county boundaries or seed data.
const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];

test('valid Polygon reports type and coordinate count while disclaiming topology checks', () => {
  const result = validateGeometry({ type: 'Polygon', coordinates: [ring] });
  assert.equal(result.valid, true);
  assert.equal(result.geometryType, 'Polygon');
  assert.equal(result.coordinateCount, 4);
  assert.deepEqual(result.validationErrors, []);
  assert.match(result.warnings.join(' '), /topological validity are not checked/);
});

test('valid MultiPolygon preserves and counts all polygon rings', () => {
  const result = validateGeometry({ type: 'MultiPolygon', coordinates: [[ring], [ring]] });
  assert.equal(result.valid, true);
  assert.equal(result.geometryType, 'MultiPolygon');
  assert.equal(result.coordinateCount, 8);
});

for (const [name, geometry, pattern] of [
  ['missing object', null, /geometry object/],
  ['array object', [], /geometry object/],
  ['unsupported type', { type: 'Point', coordinates: [0, 0] }, /Polygon or MultiPolygon/],
  ['empty coordinates', { type: 'Polygon', coordinates: [] }, /non-empty/],
  ['empty multipolygon', { type: 'MultiPolygon', coordinates: [[]] }, /at least one ring/],
  ['short ring', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] }, /at least four/],
  ['open ring', { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }, /must be closed/],
  ['out-of-range longitude', { type: 'Polygon', coordinates: [[[181, 0], [1, 0], [1, 1], [181, 0]]] }, /outside longitude/],
  ['out-of-range latitude', { type: 'Polygon', coordinates: [[[0, -91], [1, 0], [1, 1], [0, -91]]] }, /outside longitude/],
  ['nonfinite number', { type: 'Polygon', coordinates: [[[NaN, 0], [1, 0], [1, 1], [NaN, 0]]] }, /finite numbers/],
  ['string coordinate', { type: 'Polygon', coordinates: [[['0', 0], [1, 0], [1, 1], ['0', 0]]] }, /finite numbers/],
  ['three-dimensional position', { type: 'Polygon', coordinates: [[[0, 0, 0], [1, 0], [1, 1], [0, 0, 0]]] }, /exactly two/],
  ['degenerate ring', { type: 'Polygon', coordinates: [[[0, 0], [0, 0], [0, 0], [0, 0]]] }, /distinct positions/],
  ['custom CRS', { type: 'Polygon', coordinates: [ring], crs: { type: 'name', properties: { name: 'EPSG:3857' } } }, /Custom CRS/],
]) {
  test(`rejects ${name} with a meaningful error`, () => {
    const result = validateGeometry(geometry);
    assert.equal(result.valid, false);
    assert.match(result.validationErrors.join(' '), pattern);
  });
}

test('geometry byte and coordinate limits are enforced', () => {
  const oversized = validateGeometry({ type: 'Polygon', coordinates: [ring], foreign: 'x'.repeat(MAX_GEOMETRY_BYTES) });
  assert.equal(oversized.valid, false);
  assert.match(oversized.validationErrors.join(' '), /size limit/);
  const tooMany = validateGeometry({ type: 'Polygon', coordinates: [Array.from({ length: MAX_COORDINATES + 1 }, () => [0, 0])] });
  assert.equal(tooMany.valid, false);
  assert.match(tooMany.validationErrors.join(' '), /coordinate limit/);
});

test('list query accepts only supported bounded filters and pagination', () => {
  assert.deepEqual(parseListQuery({ page: '2', limit: '5', areaType: 'county', geoid: '19169', includeGeometry: 'true' }), {
    page: 2, limit: 5, filter: { isActive: true, areaType: 'county', geoid: '19169' }, includeGeometry: true,
  });
  for (const query of [{ page: '0' }, { limit: '101' }, { page: '10001' }, { geoid: { $ne: null } }, { areaType: 'other' }, { includeGeometry: ['true', 'false'] }, { $where: 'code' }]) {
    assert.throws(() => parseListQuery(query), (error) => error.status === 400);
  }
});
