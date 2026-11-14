import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { serve, captureLogger } from './helpers/http.js';

async function setup(t) {
  const logger = captureLogger();
  const database = {
    isReady: () => false,
    getStatus: () => ({ configured: false, ready: false, name: null, status: 'unconfigured' }),
    getConnection() { throw new Error('Scenario foundation must not access MongoDB.'); },
  };
  const base = await serve(createApp({ config: parseEnv({}), database, logger }), t);
  return { base, logger };
}
const post = (base, payload) => fetch(`${base}/api/v1/scenarios/preferences/validate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
});

test('scenario APIs work without MongoDB and keep existing database health semantics', async (t) => {
  const { base } = await setup(t);
  const response = await fetch(`${base}/api/v1/scenarios`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.equal(body.data.items.length, 3);
  assert.equal(body.data.readiness.scientificEvaluationReady, false);
  assert.equal(body.data.readiness.recommendationGenerationEnabled, false);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/health/ready`)).status, 503);
  assert.equal((await fetch(`${base}/api/v1/datasets`)).status, 503);
});

test('valid preference API returns original and normalized weights with validation and readiness metadata', async (t) => {
  const { base } = await setup(t);
  const response = await post(base, { weights: { water: 50, soilHealth: 30, productivity: 20 } });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.success, true);
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.deepEqual(Object.keys(body.data).sort(), ['valid', 'originalWeights', 'normalizedWeights', 'readiness'].sort());
  assert.equal(body.data.valid, true);
  assert.deepEqual(body.data.originalWeights, { water: 50, soilHealth: 30, productivity: 20 });
  assert.deepEqual(body.data.normalizedWeights, { water: 0.5, soilHealth: 0.3, productivity: 0.2 });
  assert.equal(body.data.readiness.finalDataDependenciesStatus, 'available');
  assert.equal(body.data.readiness.scientificEvaluationStatus, 'not_implemented');
});

test('both Scenario APIs distinguish validated delivery from unassessed science and disabled evaluation', async (t) => {
  const { base } = await setup(t);
  const catalog = await (await fetch(`${base}/api/v1/scenarios`)).json();
  const preferences = await (await post(base, { weights: { water: 50, soilHealth: 30, productivity: 20 } })).json();
  assert.deepEqual(preferences.data.readiness, catalog.data.readiness);
  const readiness = catalog.data.readiness;
  assert.equal(readiness.dataContractStatus, 'supported');
  assert.equal(readiness.dataContractVersion, '1.0.0');
  assert.equal(readiness.structuralValidationStatus, 'passed');
  assert.equal(readiness.scientificValidationStatus, 'not_assessed');
  assert.equal(readiness.scientificEvaluationStatus, 'not_implemented');
  assert.equal(readiness.scientificEvaluationReady, false);
  assert.equal(readiness.recommendationGenerationEnabled, false);
  assert.ok(!readiness.blockers.includes('final_data_contract_pending'));
  assert.ok(!readiness.blockers.includes('verified_inputs_pending'));
  assert.ok(readiness.blockers.includes('scientific_validation_not_assessed'));
  assert.ok(readiness.blockers.includes('scenario_inputs_pending'));
  assert.ok(readiness.blockers.includes('evaluation_methodology_pending'));
});

test('invalid preference API uses existing error envelope and sanitized field errors', async (t) => {
  const { base, logger } = await setup(t);
  for (const payload of [
    {}, { weights: null }, { weights: [] }, { weights: { water: 50, soilHealth: 30 } },
    { weights: { water: -1, soilHealth: 30, productivity: 20 } },
    { weights: { water: 101, soilHealth: 30, productivity: 20 } },
    { weights: { water: 0, soilHealth: 0, productivity: 0 } },
    { weights: { water: 'private-value', soilHealth: 30, productivity: 20, 'private-key': 1 } },
    { weights: { water: 50, soilHealth: 30, productivity: 20 }, 'private-key': 1 },
  ]) {
    const response = await post(base, payload);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(body.error.code, 'INVALID_PREFERENCES');
    assert.ok(body.error.details.errors.length > 0);
    for (const error of body.error.details.errors) {
      assert.deepEqual(Object.keys(error).sort(), ['field', 'code', 'message'].sort());
    }
    assert.doesNotMatch(JSON.stringify(body), /private-value|private-key|stack/);
  }
  assert.doesNotMatch(logger.messages.join('\n'), /private-value|private-key/);
});

test('scenario validation inherits JSON parsing, body limits, and CORS errors', async (t) => {
  const { base, logger } = await setup(t);
  for (const [payload, status, code] of [
    ['{"private-value":', 400, 'INVALID_JSON'],
    [JSON.stringify({ weights: { water: 'x'.repeat(110000) } }), 413, 'PAYLOAD_TOO_LARGE'],
  ]) {
    const response = await fetch(`${base}/api/v1/scenarios/preferences/validate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    const body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.error.code, code);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
  }
  const noBody = await fetch(`${base}/api/v1/scenarios/preferences/validate`, { method: 'POST' });
  assert.equal(noBody.status, 400);
  assert.equal((await noBody.json()).error.code, 'INVALID_PREFERENCES');
  const denied = await fetch(`${base}/api/v1/scenarios`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED');
  assert.doesNotMatch(logger.messages.join('\n'), /private-value/);
});

test('preferences remain stateless and comparison/recommendation routes remain unavailable', async (t) => {
  const { base } = await setup(t);
  const before = await (await fetch(`${base}/api/v1/scenarios`)).json();
  await post(base, { weights: { water: 100, soilHealth: 0, productivity: 0 } });
  const response = await post(base, { weights: { water: 0, soilHealth: 1, productivity: 1 } });
  assert.deepEqual((await response.json()).data.normalizedWeights, { water: 0, soilHealth: 0.5, productivity: 0.5 });
  assert.deepEqual((await (await fetch(`${base}/api/v1/scenarios`)).json()).data, before.data);
  for (const path of ['/api/v1/scenarios/compare', '/api/v1/scenarios/recommend', '/api/v1/scenarios/recommendations']) {
    const result = await fetch(base + path, { method: 'POST' });
    assert.equal(result.status, 404);
    assert.equal((await result.json()).error.code, 'NOT_FOUND');
  }
});
