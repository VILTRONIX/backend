import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { finalFixture } from './helpers/engine-v1.js';
import { serve, captureLogger } from './helpers/http.js';
import { verifyEngineCompatibility } from '../scripts/verifyEngineCompatibility.js';
import { resolveEnginePaths } from '../src/config/features.js';

test('all ten actual Engine route shapes and source-specific filters pass read-only HTTP verification', async (t) => {
  const fixture = await finalFixture(t);
  const before = await readFile(path.join(fixture.root, 'data/processed/features/feature_manifest.json'));
  const result = await verifyEngineCompatibility(resolveEnginePaths({ TERRAPULSE_ENGINE_ROOT: fixture.root }));
  assert.equal(result.endpoints.length, 10);
  assert.ok(result.endpoints.every((entry) => entry.status === 200));
  assert.equal(result.filters.length, 8);
  assert.equal(result.mongodbUsed, false);
  assert.deepEqual(await readFile(path.join(fixture.root, 'data/processed/features/feature_manifest.json')), before);
});

test('API keeps safe errors, request IDs, and Scenario behavior without a database', async (t) => {
  const fixture = await finalFixture(t), logger = captureLogger();
  const database = { isReady: () => false, getStatus: () => ({ configured: false, ready: false, status: 'unconfigured' }),
    getConnection() { throw new Error('No MongoDB access is authorized.'); } };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: fixture.root }), database, logger }), t);
  const invalid = await fetch(`${base}/api/v1/engine/climate/monthly?location_id[$ne]=private-value`), error = await invalid.json();
  assert.equal(invalid.status, 400); assert.equal(error.error.code, 'INVALID_ENGINE_QUERY');
  assert.equal(error.requestId, invalid.headers.get('x-request-id'));
  assert.doesNotMatch(JSON.stringify(error), /private-value|stack/);
  assert.equal((await fetch(`${base}/api/v1/scenarios`)).status, 200);
  const preferences = await fetch(`${base}/api/v1/scenarios/preferences/validate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weights: { water: 50, soilHealth: 30, productivity: 20 } }),
  });
  assert.deepEqual((await preferences.json()).data.normalizedWeights, { water: 0.5, soilHealth: 0.3, productivity: 0.2 });
  assert.equal((await fetch(`${base}/api/v1/observations/vegetation`)).status, 503);
  assert.equal((await fetch(`${base}/health/live`)).status, 200);
  assert.doesNotMatch(logger.messages.join('\n'), /private-value/);
});
