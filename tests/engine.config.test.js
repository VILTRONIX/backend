import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { parseEnv } from '../src/config/env.js';
import { DEFAULT_FEATURES_ROOT, resolveFeaturesRoot } from '../src/config/features.js';

test('features root defaults relative to the module and never repurposes the existing data root', () => {
  assert.equal(resolveFeaturesRoot(), path.resolve(DEFAULT_FEATURES_ROOT));
  assert.equal(resolveFeaturesRoot({ TERRAPULSE_DATA_ROOT: path.join(tmpdir(), 'other-data') }), path.resolve(DEFAULT_FEATURES_ROOT));
  const override = path.join(tmpdir(), 'synthetic-engine-config-only');
  assert.equal(parseEnv({ TERRAPULSE_FEATURES_ROOT: override }).featuresRoot, override);
});

test('configured feature roots reject relative paths, traversal, network roots, and invalid values safely', () => {
  for (const value of ['', 'relative/features', '../features', path.join(tmpdir(), 'features') + '/../../private',
    path.parse(path.resolve(tmpdir())).root, '\\\\server\\private', '/%2e%2e/private', 'private\0path', 'https://private.example/features']) {
    assert.throws(() => resolveFeaturesRoot({ TERRAPULSE_FEATURES_ROOT: value }), (error) => {
      assert.match(error.message, /TERRAPULSE_FEATURES_ROOT/);
      assert.doesNotMatch(error.message, /private|server|example/);
      return true;
    });
  }
});
