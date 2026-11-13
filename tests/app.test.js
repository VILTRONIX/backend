import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { requestId } from '../src/middleware/requestId.js';
import { createErrorHandler } from '../src/middleware/errorHandler.js';
import { serve, captureLogger } from './helpers/http.js';

async function setup(context) {
  let ready = false;
  const database = {
    isReady: () => ready,
    getStatus: () => ({ configured: true, ready, name: ready ? 'terrapulse' : null, status: ready ? 'connected' : 'disconnected' }),
  };
  const logger = captureLogger();
  const app = createApp({ config: parseEnv({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost/terrapulse', CLIENT_URL: 'https://terrapulse.example' }), database, logger });
  return { base: await serve(app, context), logger, setReady: (value) => { ready = value; } };
}

test('welcome and meta endpoints describe the foundation without claiming ingested data', async (t) => {
  const { base } = await setup(t);
  const welcome = await fetch(`${base}/`);
  assert.equal(welcome.status, 200);
  assert.equal((await welcome.json()).data.message, 'Welcome to the TerraPulse API.');
  const response = await fetch(`${base}/api/v1/meta`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.deepEqual(body.data, {
    project: 'TerraPulse', apiVersion: 'v1', pilotLocation: 'Story County, Iowa, USA', environment: 'production', serviceStatus: 'degraded',
  });
});

test('liveness remains 200 while readiness tracks database disconnection and recovery', async (t) => {
  const { base, setReady } = await setup(t);
  const live = await fetch(`${base}/health/live`);
  assert.equal(live.status, 200);
  assert.equal((await live.json()).data.status, 'alive');

  for (const ready of [false, true, false]) {
    setReady(ready);
    const response = await fetch(`${base}/health/ready`);
    const body = await response.json();
    assert.equal(response.status, ready ? 200 : 503);
    assert.equal(body.success, ready);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (ready) {
      assert.equal(body.data.database.status, 'connected');
      assert.equal(body.data.database.name, 'terrapulse');
    }
    else assert.equal(body.error.code, 'NOT_READY');
    const meta = await (await fetch(`${base}/api/v1/meta`)).json();
    assert.equal(meta.data.serviceStatus, ready ? 'ready' : 'degraded');
  }
});

test('request IDs correlate headers and JSON; security headers are enabled', async (t) => {
  const { base } = await setup(t);
  const response = await fetch(`${base}/`, { headers: { 'X-Request-ID': 'untrusted-input' } });
  const body = await response.json();
  assert.match(body.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(response.headers.get('x-request-id'), body.requestId);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.ok(response.headers.get('content-security-policy'));
});

test('CORS allows configured origins and rejects other origins without wildcards', async (t) => {
  const { base } = await setup(t);
  const allowed = await fetch(`${base}/`, { headers: { Origin: 'https://terrapulse.example' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://terrapulse.example');
  assert.match(allowed.headers.get('access-control-expose-headers'), /X-Request-ID/);
  const denied = await fetch(`${base}/`, { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error.code, 'CORS_ORIGIN_DENIED');
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const preflight = await fetch(`${base}/api/v1/meta`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://terrapulse.example', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(preflight.status, 204);
});

test('unknown routes produce consistent 404 JSON without reflecting paths or queries', async (t) => {
  const { base, logger } = await setup(t);
  const response = await fetch(`${base}/private-path-secret?token=query-secret`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.error.code, 'NOT_FOUND');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.doesNotMatch(JSON.stringify(body), /private-path-secret|query-secret/);
  assert.doesNotMatch(logger.messages.join('\n'), /private-path-secret|query-secret/);
});

test('invalid JSON and oversized bodies return safe 400 and 413 errors', async (t) => {
  const { base, logger } = await setup(t);
  for (const [payload, status, code] of [
    ['{"secret-password":', 400, 'INVALID_JSON'],
    [JSON.stringify({ value: 'x'.repeat(110000) }), 413, 'PAYLOAD_TOO_LARGE'],
  ]) {
    const response = await fetch(`${base}/api/v1/meta`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload,
    });
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /secret-password|stack/);
  }
  assert.doesNotMatch(logger.messages.join('\n'), /secret-password/);
});

test('unexpected errors never expose raw messages, credentials, or stack traces in responses or logs', async (t) => {
  const logger = captureLogger();
  const app = express();
  app.use(requestId);
  app.get('/failure', async () => {
    throw new Error('mongodb+srv://user:private-password@example.com/db');
  });
  app.use(createErrorHandler({ logger }));
  const base = await serve(app, t);
  const response = await fetch(`${base}/failure`);
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, 'INTERNAL_SERVER_ERROR');
  assert.doesNotMatch(JSON.stringify(body), /private-password|mongodb|stack/);
  assert.doesNotMatch(logger.messages.join('\n'), /private-password|mongodb/);
  assert.match(logger.messages.join('\n'), new RegExp(body.requestId));
});
