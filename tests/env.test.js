import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEnv } from '../src/config/env.js';
import { resolveEnginePaths } from '../src/config/features.js';

test('development defaults permit an unconfigured database', () => {
  assert.deepEqual(parseEnv({}), {
    port: 5000,
    nodeEnv: 'development',
    mongodbUri: '',
    ...resolveEnginePaths(),
    clientOrigins: ['http://localhost:5173'],
  });
});

test('Atlas configuration accepts multiple explicit frontend origins', () => {
  const config = parseEnv({
    NODE_ENV: 'production',
    PORT: '8080',
    MONGODB_URI: 'mongodb+srv://user:encoded-password@cluster.example/terrapulse',
    CLIENT_URL: 'https://terrapulse.example, https://advisor.example',
  });
  assert.equal(config.port, 8080);
  assert.equal(config.nodeEnv, 'production');
  assert.deepEqual(config.clientOrigins, ['https://terrapulse.example', 'https://advisor.example']);
});

for (const port of ['', '0', '-1', '65536', '5000abc', '5.5', 'Infinity']) {
  test(`rejects invalid PORT ${JSON.stringify(port)}`, () => {
    assert.throws(() => parseEnv({ PORT: port }), /PORT must/);
  });
}

test('production requires explicit database and frontend configuration', () => {
  assert.throws(() => parseEnv({ NODE_ENV: 'production' }), /MONGODB_URI is required/);
  assert.throws(() => parseEnv({ NODE_ENV: 'production', MONGODB_URI: 'mongodb://localhost/terrapulse' }), /CLIENT_URL/);
});

test('rejects unknown environments and invalid URI schemes without echoing secrets', () => {
  assert.throws(() => parseEnv({ NODE_ENV: 'staging' }), /NODE_ENV must/);
  assert.throws(() => parseEnv({ MONGODB_URI: 'https://secret-password@example.com' }), (error) => {
    assert.match(error.message, /MONGODB_URI must/);
    assert.doesNotMatch(error.message, /secret-password/);
    return true;
  });
});

for (const origin of ['*', 'https://*.example.com', 'https://example.com/path', 'https://example.com/', 'https://user:secret@example.com', 'https://example.com,', 'ftp://example.com']) {
  test(`rejects unsafe CLIENT_URL ${JSON.stringify(origin)}`, () => {
    assert.throws(() => parseEnv({ CLIENT_URL: origin }), /CLIENT_URL/);
  });
}
