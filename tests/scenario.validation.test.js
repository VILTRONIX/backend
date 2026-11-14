import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/utils/appError.js';
import { validatePreferenceWeights, validatePreferenceRequest } from '../src/modules/scenarios/scenario.validation.js';

const weights = { water: 50, soilHealth: 30, productivity: 20 };
function expectInvalid(operation, code, field) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.status, 400);
    assert.equal(error.code, 'INVALID_PREFERENCES');
    assert.ok(error.details.errors.some((entry) => entry.code === code && (!field || entry.field === field)));
    return true;
  });
}

test('valid preferences preserve original weights, normalize relative importance, and never mutate input', () => {
  const input = Object.freeze({ ...weights });
  const result = validatePreferenceRequest(Object.freeze({ weights: input }));
  assert.deepEqual(result, {
    valid: true, originalWeights: weights,
    normalizedWeights: { water: 0.5, soilHealth: 0.3, productivity: 0.2 },
  });
  result.originalWeights.water = 1;
  assert.deepEqual(input, weights);
});

test('normalization accepts arbitrary nonzero totals, decimals, boundaries, and very small positive numbers', () => {
  for (const original of [
    { water: 1, soilHealth: 1, productivity: 1 },
    { water: 100, soilHealth: 100, productivity: 100 },
    { water: 0, soilHealth: 100, productivity: 0 },
    { water: 0.25, soilHealth: 0.5, productivity: 0.75 },
    { water: Number.MIN_VALUE, soilHealth: Number.MIN_VALUE, productivity: Number.MIN_VALUE },
  ]) {
    const result = validatePreferenceWeights(original);
    assert.deepEqual(result.originalWeights, original);
    const normalized = Object.values(result.normalizedWeights);
    assert.ok(Math.abs(normalized.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
    assert.ok(normalized.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
  }
  assert.deepEqual(validatePreferenceWeights({ water: 0, soilHealth: 100, productivity: 0 }).normalizedWeights,
    { water: 0, soilHealth: 1, productivity: 0 });
  assert.deepEqual(validatePreferenceWeights({ water: 5, soilHealth: 3, productivity: 2 }).normalizedWeights,
    validatePreferenceWeights(weights).normalizedWeights);
});

test('all-zero weights are rejected', () => {
  expectInvalid(() => validatePreferenceWeights({ water: 0, soilHealth: 0, productivity: 0 }), 'ALL_ZERO', 'weights');
});

for (const criterion of Object.keys(weights)) {
  test(`missing ${criterion} is rejected`, () => {
    const incomplete = { ...weights };
    delete incomplete[criterion];
    expectInvalid(() => validatePreferenceWeights(incomplete), 'REQUIRED', `weights.${criterion}`);
  });
  test(`invalid ${criterion} types and ranges are rejected without coercion`, () => {
    for (const value of [-1, -0.001, 100.001, 101]) {
      expectInvalid(() => validatePreferenceWeights({ ...weights, [criterion]: value }), 'OUT_OF_RANGE', `weights.${criterion}`);
    }
    for (const value of ['50', '', true, false, null, undefined, NaN, Infinity, -Infinity, [], {}]) {
      expectInvalid(() => validatePreferenceWeights({ ...weights, [criterion]: value }), 'INVALID_TYPE', `weights.${criterion}`);
    }
  });
}

test('weight containers must be records with exactly the supported own criteria', () => {
  for (const value of [null, undefined, [], 50, 'weights', new Date(), Object.create(weights)]) {
    expectInvalid(() => validatePreferenceWeights(value), 'INVALID_TYPE', 'weights');
  }
  for (const extra of [{ Water: 1 }, { soil: 1 }, { surprise: 1 }, { [Symbol('criterion')]: 1 }]) {
    expectInvalid(() => validatePreferenceWeights({ ...weights, ...extra }), 'UNSUPPORTED_CRITERIA', 'weights');
  }
  const pollution = JSON.parse('{"water":50,"soilHealth":30,"productivity":20,"__proto__":{"polluted":true}}');
  expectInvalid(() => validatePreferenceWeights(pollution), 'UNSUPPORTED_CRITERIA', 'weights');
  assert.equal({}.polluted, undefined);
  assert.equal(validatePreferenceWeights(Object.assign(Object.create(null), weights)).valid, true);
});

test('request envelope rejects missing weights, non-objects, inherited weights, and extra fields', () => {
  for (const body of [undefined, null, [], {}, 42, 'weights', Object.create({ weights })]) {
    expectInvalid(() => validatePreferenceRequest(body), 'REQUIRED', 'weights');
  }
  expectInvalid(() => validatePreferenceRequest({ weights, scenarioId: 'water_first' }), 'UNSUPPORTED_FIELD', 'body');
});

test('validation aggregates criterion errors without returning user-supplied values or unknown keys', () => {
  assert.throws(() => validatePreferenceWeights({ water: 'private-input', soilHealth: -1, 'private-key': true }), (error) => {
    assert.equal(error.details.errors.length, 4);
    assert.doesNotMatch(JSON.stringify(error.details), /private-input|private-key/);
    return true;
  });
});
