import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { ENGINE_DATASETS } from '../src/modules/engine/engine.registry.js';
import { engineFixture } from './helpers/engine.js';
import { serve, captureLogger } from './helpers/http.js';

async function setup(t, fixture) {
  const logger = captureLogger();
  const database = {
    isReady: () => false,
    getStatus: () => ({ configured: false, ready: false, status: 'unconfigured', name: null }),
    getConnection() { throw new Error('Engine file readers must not access MongoDB.'); },
  };
  const app = createApp({ config: parseEnv({ TERRAPULSE_FEATURES_ROOT: fixture.root }), database, logger });
  return { base: await serve(app, t), logger };
}

test('all eight namespaced record routes read manifest-mapped fixtures with consistent envelopes and provenance', async (t) => {
  const fixture = await engineFixture(t), template = fixture.manifest.datasets[0];
  fixture.manifest.datasets = ENGINE_DATASETS.map(({ id }) => ({ ...structuredClone(template), logicalId: id, id: `synthetic-${id}` }));
  await fixture.writeManifest();
  const { base } = await setup(t, fixture);
  const list = await (await fetch(`${base}/api/v1/engine/datasets`)).json();
  assert.ok(list.data.items.every(({ status }) => status === 'available'));
  for (const definition of ENGINE_DATASETS) {
    const response = await fetch(`${base}/api/v1/engine${definition.route}?page=2&limit=2`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.requestId, response.headers.get('x-request-id'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(body.data.items, fixture.records.slice(2));
    assert.equal(body.data.dataset.id, definition.id);
    assert.equal(body.data.dataset.verification.scientific, 'not_assessed');
    assert.ok(body.data.dataset.provenance.manifestChecksum);
  }
  const lookup = await (await fetch(`${base}/api/v1/engine/soil/map-units?mapUnit=synthetic-u1`)).json();
  assert.equal(lookup.data.pagination.total, 2);
  const filtered = await (await fetch(`${base}/api/v1/engine/climate/monthly?startDate=2020-02&endDate=2020-03`)).json();
  assert.equal(filtered.data.pagination.total, 2);
  const detail = await (await fetch(`${base}/api/v1/engine/datasets/power_monthly`)).json();
  assert.equal(detail.data.structurallyReady, true);
});

test('missing manifest leaves Express, Scenario APIs, and all eight availability definitions accessible', async (t) => {
  const fixture = await engineFixture(t);
  await unlink(path.join(fixture.root, 'feature_manifest.json'));
  const { base } = await setup(t, fixture);
  const catalog = await fetch(`${base}/api/v1/engine/datasets`);
  assert.equal(catalog.status, 200);
  const body = await catalog.json();
  assert.equal(body.data.items.length, 8);
  assert.ok(body.data.items.every(({ status }) => status === 'missing_manifest'));
  for (const { route, id, optional } of ENGINE_DATASETS) {
    const response = await fetch(`${base}/api/v1/engine${route}`), unavailable = await response.json();
    assert.equal(response.status, 503);
    assert.equal(unavailable.error.code, 'ENGINE_DATASET_UNAVAILABLE');
    assert.equal(unavailable.error.details.datasetId, id);
    assert.equal(unavailable.error.details.optional, optional);
    assert.equal(unavailable.error.details.status, 'missing_manifest');
    assert.equal(unavailable.requestId, response.headers.get('x-request-id'));
  }
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.equal((await fetch(`${base}/health/ready`)).status, 503);
  assert.equal((await fetch(`${base}/api/v1/scenarios`)).status, 200);
  const preferences = await fetch(`${base}/api/v1/scenarios/preferences/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ weights: { water: 50, soilHealth: 30, productivity: 20 } }),
  });
  assert.deepEqual((await preferences.json()).data.normalizedWeights, { water: 0.5, soilHealth: 0.3, productivity: 0.2 });
});

test('Engine errors use existing safe 400, 404, and 503 envelopes without paths or unknown input reflection', async (t) => {
  const fixture = await engineFixture(t), { base, logger } = await setup(t, fixture);
  for (const [route, status, code] of [
    ['/datasets?private-query=private-value', 400, 'INVALID_ENGINE_QUERY'],
    ['/datasets/private-id', 404, 'ENGINE_DATASET_NOT_FOUND'],
    ['/climate/monthly?limit=101', 400, 'INVALID_ENGINE_QUERY'],
    ['/climate/monthly?year[$ne]=2020', 400, 'INVALID_ENGINE_QUERY'],
    ['/climate/merra2', 503, 'ENGINE_DATASET_UNAVAILABLE'],
  ]) {
    const response = await fetch(`${base}/api/v1/engine${route}`), body = await response.json();
    assert.equal(response.status, status);
    assert.equal(body.success, false);
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private-query|private-value|private-id|stack/);
  }
  fixture.manifest.datasets[0].files[0].path = '../private-source-marker'; await fixture.writeManifest();
  const result = await fetch(`${base}/api/v1/engine/climate/monthly`), body = await result.json();
  assert.equal(result.status, 503);
  assert.equal(body.error.details.reason, 'unsafe_reference');
  assert.doesNotMatch(JSON.stringify(body), /private-source-marker/);
  assert.ok(!JSON.stringify(body).includes(fixture.root));
  assert.doesNotMatch(logger.messages.join('\n'), /private-source-marker|private-query|private-value|private-id/);
});
