import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, writeFile, unlink, utimes } from 'node:fs/promises';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { FORMAT_ADAPTERS } from '../src/modules/engine/engine.loaders.js';
import { createApp } from '../src/app.js';
import { parseEnv, loadEnv, loadEnginePaths } from '../src/config/env.js';
import { finalFixture, csvBytes } from './helpers/engine-v1.js';
import { serve, captureLogger } from './helpers/http.js';

const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
async function setup(t, options = {}, decorate = (adapter) => adapter) {
  const fixture = await finalFixture(t), scans = [];
  const adapter = async (source, onRecord, limits, context) => {
    scans.push(context.schema['x-dataset'].dataset_name);
    return FORMAT_ADAPTERS.csv(source, onRecord, limits, context);
  };
  const engine = createEngineService({ engineRoot: fixture.root, ...options, adapters: { ...FORMAT_ADAPTERS, csv: decorate(adapter) } });
  return { fixture, engine, scans };
}
const unavailable = (reason) => (error) => error.code === 'ENGINE_DATASET_UNAVAILABLE' && error.details.reason === reason;

test('validated snapshots serve catalog, detail, filters and all pages without parsing or validating again', async (t) => {
  const { fixture, engine, scans } = await setup(t);
  const first = await engine.readDataset('power_monthly', { limit: '1' });
  const stats = engine.getCacheStats();
  assert.equal(first.pagination.total, 4); assert.equal(scans.length, 1);
  assert.equal(stats.datasetValidations, 1); assert.equal(stats.recordValidations, 4); assert.equal(stats.manifestReads, 1);
  await engine.getDataset('power_monthly');
  const page = await engine.readDataset('power_monthly', { page: '2', limit: '1' });
  const filtered = await engine.readDataset('power_monthly', { location_id: 'synthetic-B' });
  assert.deepEqual(page.items, [fixture.forLogicalId('power_monthly').rows[1]]);
  assert.equal(filtered.pagination.total, 2);
  assert.equal(scans.length, 1); assert.equal(engine.getCacheStats().recordValidations, 4);
  await engine.listDatasets(); const afterCatalog = engine.getCacheStats();
  await engine.listDatasets();
  assert.equal(scans.length, 8); assert.equal(afterCatalog.entries, 8);
  assert.equal(engine.getCacheStats().datasetValidations, 8); assert.equal(engine.getCacheStats().manifestReads, 1);
});

test('concurrent requests for one dataset share a single complete validation', async (t) => {
  const entered = gate(), release = gate(); t.after(() => release.resolve());
  const { engine, scans } = await setup(t, {}, (adapter) => async (...args) => {
    const result = await adapter(...args); entered.resolve(); await release.promise; return result;
  });
  const first = engine.readDataset('power_monthly', { limit: '1' }); await entered.promise;
  const others = [engine.getDataset('power_monthly'), engine.readDataset('power_monthly', { location_id: 'synthetic-B' })];
  assert.equal(engine.getCacheStats().entries, 0, 'Partially validated rows must remain unpublished.');
  release.resolve(); const [a, b, c] = await Promise.all([first, ...others]);
  assert.equal(a.items.length, 1); assert.equal(b.structurallyReady, true); assert.equal(c.items.length, 2);
  assert.equal(scans.length, 1); assert.ok(engine.getCacheStats().coalesced >= 1);
});

test('an independent dataset loads while another dataset is paused', async (t) => {
  const entered = gate(), release = gate(); t.after(() => release.resolve());
  const { engine } = await setup(t, {}, (adapter) => async (...args) => {
    if (args[3].schema.properties.location_id) { entered.resolve(); await release.promise; }
    return adapter(...args);
  });
  const power = engine.readDataset('power_monthly'); await entered.promise;
  const soil = await engine.readDataset('soil_map_units');
  assert.equal(soil.pagination.total, 2); assert.equal(engine.getCacheStats().entries, 1);
  release.resolve(); await power;
});

test('returned metadata and records cannot mutate a validated snapshot', async (t) => {
  const { engine, scans } = await setup(t);
  const first = await engine.readDataset('power_monthly');
  first.items[0].location_id = 'mutated'; first.dataset.metadata.fields.location_id.description = 'mutated';
  const detail = await engine.getDataset('power_monthly'); detail.provenance.manifestChecksum = 'mutated';
  const again = await engine.readDataset('power_monthly');
  assert.equal(again.items[0].location_id, 'synthetic-A');
  assert.notEqual(again.dataset.metadata.fields.location_id.description, 'mutated');
  assert.notEqual(again.dataset.provenance.manifestChecksum, 'mutated'); assert.equal(scans.length, 1);
});

test('a manifest metadata change rehashes and invalidates dependent snapshots even if its parsed content is unchanged', async (t) => {
  const { fixture, engine, scans } = await setup(t);
  await engine.listDatasets(); const original = await engine.getDataset('power_monthly');
  await writeFile(path.join(fixture.root, 'data/processed/features/feature_manifest.json'), JSON.stringify(fixture.manifest, null, 2));
  const refreshed = await engine.getDataset('power_monthly');
  assert.equal(refreshed.structurallyReady, true);
  assert.notEqual(refreshed.provenance.manifestChecksum, original.provenance.manifestChecksum);
  assert.equal(engine.getCacheStats().manifestReads, 2); assert.equal(engine.getCacheStats().entries, 1);
  assert.equal(scans.length, 9);
});

test('missing and malformed manifests never fall back to a previously valid snapshot and can recover', async (t) => {
  const { fixture, engine } = await setup(t), file = path.join(fixture.root, 'data/processed/features/feature_manifest.json');
  await engine.readDataset('power_monthly'); const original = await readFile(file);
  await unlink(file);
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('missing_manifest'));
  assert.equal(engine.getCacheStats().entries, 0);
  await writeFile(file, '{');
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('invalid_json_document'));
  await writeFile(file, original); assert.equal((await engine.readDataset('power_monthly')).pagination.total, 4);
});

test('unchanged schema bytes with changed metadata trigger full schema and record validation', async (t) => {
  const { fixture, engine, scans } = await setup(t), file = path.join(fixture.root, fixture.forLogicalId('power_monthly').entry.schema_path);
  await engine.readDataset('power_monthly'); const next = new Date(Date.now() + 60000); await utimes(file, next, next);
  await engine.readDataset('power_monthly');
  assert.equal(scans.length, 2); assert.equal(engine.getCacheStats().schemaValidations, 2);
  assert.equal(engine.getCacheStats().recordValidations, 8);
});

test('a schema checksum mismatch invalidates a warm snapshot and restoration permits a fresh validation', async (t) => {
  const { fixture, engine } = await setup(t), file = path.join(fixture.root, fixture.forLogicalId('power_monthly').entry.schema_path);
  await engine.readDataset('power_monthly'); const original = await readFile(file);
  await writeFile(file, Buffer.concat([original, Buffer.from('\n')]));
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('schema_checksum_mismatch'));
  assert.equal(engine.getCacheStats().entries, 0);
  await writeFile(file, original); assert.equal((await engine.readDataset('power_monthly')).dataset.structurallyReady, true);
});

test('a changed manifest with matching hashes still rejects an invalid refreshed schema', async (t) => {
  const { fixture, engine } = await setup(t), schema = fixture.forLogicalId('power_monthly').schema;
  await engine.readDataset('power_monthly'); schema.properties.sample_value.type = 'unsupported'; await fixture.publish();
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('invalid_schema_type'));
  assert.equal(engine.getCacheStats().entries, 0);
  schema.properties.sample_value.type = 'number'; await fixture.publish();
  assert.equal((await engine.readDataset('power_monthly')).dataset.structurallyReady, true);
});

test('CSV fingerprint changes revalidate, checksum failures never serve stale records, and failures are retryable', async (t) => {
  const { fixture, engine, scans } = await setup(t), d = fixture.forLogicalId('power_monthly'), file = path.join(fixture.root, d.entry.path);
  await engine.readDataset('power_monthly'); const original = await readFile(file);
  const next = new Date(Date.now() + 60000); await utimes(file, next, next);
  await engine.readDataset('power_monthly'); assert.equal(scans.length, 2, 'Metadata-only change must still revalidate source hashes.');
  const rows = structuredClone(d.rows); rows[0].sample_value = 9.25;
  await writeFile(file, csvBytes(d.schema['x-csv'].ordered_columns, rows));
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('output_checksum_mismatch'));
  assert.equal(engine.getCacheStats().entries, 0);
  await assert.rejects(engine.readDataset('power_monthly'), unavailable('output_checksum_mismatch'));
  assert.equal(scans.length, 4, 'Failed snapshots must not be retained.');
  await writeFile(file, original); assert.equal((await engine.readDataset('power_monthly')).items[0].sample_value, 1.25);
  assert.equal(scans.length, 5);
});

test('missing warm schema and CSV files fail closed without stale data', async (t) => {
  for (const [field, reason] of [['path', 'missing_file'], ['schema_path', 'schema_missing']]) {
    const { fixture, engine } = await setup(t); await engine.readDataset('power_monthly');
    await unlink(path.join(fixture.root, fixture.forLogicalId('power_monthly').entry[field]));
    await assert.rejects(engine.readDataset('power_monthly'), unavailable(reason));
    assert.equal(engine.getCacheStats().entries, 0);
  }
});

test('a successful refresh publishes atomically and concurrent callers never receive the old version', async (t) => {
  const entered = gate(), release = gate(); let paused = false; t.after(() => release.resolve());
  const { fixture, engine, scans } = await setup(t, {}, (adapter) => async (...args) => {
    const result = await adapter(...args); if (paused) { entered.resolve(); await release.promise; } return result;
  });
  await engine.readDataset('power_monthly'); fixture.forLogicalId('power_monthly').rows[0].sample_value = 2.5; await fixture.publish();
  paused = true; let completed = false;
  const first = engine.readDataset('power_monthly').then((value) => { completed = true; return value; });
  await entered.promise; const second = engine.readDataset('power_monthly');
  assert.equal(completed, false); assert.equal(engine.getCacheStats().entries, 0);
  release.resolve(); const results = await Promise.all([first, second]);
  assert.ok(results.every((value) => value.items[0].sample_value === 2.5)); assert.equal(scans.length, 2);
});

test('concurrent failed refreshes share validation, publish nothing and recover after source repair', async (t) => {
  const entered = gate(), release = gate(); let paused = false; t.after(() => release.resolve());
  const { fixture, engine, scans } = await setup(t, {}, (adapter) => async (...args) => {
    const result = await adapter(...args); if (paused) { entered.resolve(); await release.promise; } return result;
  });
  await engine.readDataset('power_monthly'); const d = fixture.forLogicalId('power_monthly'), file = path.join(fixture.root, d.entry.path), original = await readFile(file);
  const changed = structuredClone(d.rows); changed[0].sample_value = 8.25;
  await writeFile(file, csvBytes(d.schema['x-csv'].ordered_columns, changed)); paused = true;
  const first = assert.rejects(engine.readDataset('power_monthly'), unavailable('output_checksum_mismatch'));
  await entered.promise; const second = assert.rejects(engine.readDataset('power_monthly'), unavailable('output_checksum_mismatch'));
  release.resolve(); await Promise.all([first, second]);
  assert.equal(scans.length, 2); assert.equal(engine.getCacheStats().entries, 0);
  paused = false; await writeFile(file, original);
  assert.equal((await engine.readDataset('power_monthly')).items[0].sample_value, 1.25); assert.equal(scans.length, 3);
});

test('an in-flight validation cannot publish after its manifest/source generation changes', async (t) => {
  const entered = gate(), release = gate(); let paused = true; t.after(() => release.resolve());
  const { fixture, engine } = await setup(t, {}, (adapter) => async (...args) => {
    const result = await adapter(...args); if (paused) { entered.resolve(); await release.promise; } return result;
  });
  const old = engine.readDataset('power_monthly'); const rejected = assert.rejects(old, (error) => error.code === 'ENGINE_DATASET_UNAVAILABLE');
  await entered.promise;
  fixture.forLogicalId('power_monthly').rows[0].sample_value = 3.5; await fixture.publish();
  paused = false; const current = engine.readDataset('power_monthly'); release.resolve();
  await rejected; const value = await current;
  assert.equal(value.items[0].sample_value, 3.5);
  assert.equal((await engine.readDataset('power_monthly')).items[0].sample_value, 3.5);
});

test('entry, serialized-byte and record budgets are bounded and evicted datasets can reload', async (t) => {
  const { engine, scans } = await setup(t, { cache: { maxEntries: 1 } });
  await engine.readDataset('power_monthly'); await engine.readDataset('soil_map_units'); await engine.readDataset('power_monthly');
  assert.equal(scans.length, 3); assert.equal(engine.getCacheStats().entries, 1); assert.equal(engine.getCacheStats().evictions, 2);
  for (const cache of [{ maxBytes: 1 }, { maxRecords: 3 }]) {
    const limited = await setup(t, { cache });
    const result = await limited.engine.readDataset('power_monthly');
    assert.equal(result.pagination.total, 4, 'Oversized snapshots preserve existing read semantics through a bounded non-cached scan.');
    const stats = limited.engine.getCacheStats();
    assert.equal(stats.entries, 0); assert.ok(stats.bytes <= stats.maxBytes); assert.ok(stats.records <= stats.maxRecords);
  }
});

test('uncached reference mode and cache option validation preserve existing behavior', async (t) => {
  const { engine, scans } = await setup(t, { cache: { enabled: false } });
  await engine.readDataset('power_monthly'); await engine.readDataset('power_monthly');
  assert.equal(scans.length, 2); assert.equal(engine.getCacheStats().entries, 0); assert.equal(engine.getCacheStats().manifestReads, 2);
  for (const cache of [{ enabled: 'yes' }, { maxBytes: 0 }, { maxEntries: 1.5 }, { maxRecords: -1 }, { arbitrary: true }]) {
    assert.throws(() => createEngineService({ cache }), /cache/);
  }
});

test('cached datasets still reject invalid queries before serving cached pages', async (t) => {
  const { engine, scans } = await setup(t); await engine.readDataset('power_monthly');
  for (const query of [{ limit: '101' }, { location_id: ['a', 'b'] }, { startYear: '2021', endYear: '2020' }]) {
    await assert.rejects(engine.readDataset('power_monthly', query), (error) => error.code === 'INVALID_ENGINE_QUERY');
  }
  assert.equal(scans.length, 1);
});

test('Engine health shares API snapshots, reports seven mandatory datasets, and preserves DB health contracts', async (t) => {
  const { fixture, engine, scans } = await setup(t), logger = captureLogger(); let dbReady = false;
  const database = { isReady: () => dbReady, getStatus: () => ({ configured: dbReady, ready: dbReady, status: dbReady ? 'connected' : 'unconfigured' }),
    getConnection() { throw new Error('Engine health must not access MongoDB.'); } };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: fixture.root }), database, engineService: engine, logger }), t);
  const healthResponse = await fetch(`${base}/health/engine`), body = await healthResponse.json();
  assert.equal(healthResponse.status, 200); assert.equal(body.success, true); assert.equal(body.requestId, healthResponse.headers.get('x-request-id'));
  assert.equal(healthResponse.headers.get('cache-control'), 'no-store'); assert.equal(body.data.configuration.source, 'engine_root');
  assert.equal(body.data.mandatoryDatasets.length, 7); assert.equal(body.data.optionalDatasets.length, 1);
  assert.equal(body.data.contractVersion, '1.0.0'); assert.equal(body.data.fileIntegrityStatus, 'verified');
  assert.equal(body.data.schemaStatus, 'verified'); assert.equal(body.data.scientificVerification, 'not_assessed');
  assert.equal(scans.length, 8);
  await (await fetch(`${base}/api/v1/engine/climate/monthly`)).json(); await (await fetch(`${base}/health/engine`)).json();
  assert.equal(scans.length, 8, 'Health and data routes must use the same service instance.');
  assert.equal((await fetch(`${base}/health/live`)).status, 200); assert.equal((await fetch(`${base}/health/ready`)).status, 503);
  dbReady = true; assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  await unlink(path.join(fixture.root, fixture.forLogicalId('merra2_context').entry.path));
  const optional = await (await fetch(`${base}/health/engine`)).json();
  assert.equal(optional.data.ready, true); assert.equal(optional.data.optionalDatasets[0].status, 'missing_file');
  await unlink(path.join(fixture.root, fixture.forLogicalId('power_monthly').entry.path));
  const failed = await fetch(`${base}/health/engine`), failure = await failed.json();
  assert.equal(failed.status, 503); assert.equal(failure.error.code, 'ENGINE_NOT_READY');
  assert.equal(failure.error.details.ready, false); assert.equal((await fetch(`${base}/health/ready`)).status, 200);
  assert.ok(!JSON.stringify([body, failure]).includes(fixture.root));
  assert.doesNotMatch(JSON.stringify([body, failure]), /schema_path|source_path|storageUri/);
});

test('missing Engine configuration paths give safe Engine health failure and catalog remains accessible', async (t) => {
  const { fixture } = await setup(t), database = { isReady: () => false, getStatus: () => ({ ready: false }) };
  const base = await serve(createApp({ config: parseEnv({ TERRAPULSE_ENGINE_ROOT: path.join(fixture.root, 'not-present') }), database, logger: captureLogger() }), t);
  const response = await fetch(`${base}/health/engine`), body = await response.json();
  assert.equal(response.status, 503); assert.equal(body.error.details.configuration.status, 'unavailable');
  assert.equal(body.error.details.manifest.status, 'missing_manifest'); assert.equal(body.error.details.contractVersion, null);
  assert.equal(body.error.details.mandatoryDatasets.length, 7); assert.equal((await fetch(`${base}/api/v1/engine/datasets`)).status, 200);
  assert.ok(!JSON.stringify(body).includes(fixture.root));
});

test('runtime and verifier path loading use the same dotenv precedence and root resolver without exposing values', async (t) => {
  const fixture = await finalFixture(t);
  const overrides = { NODE_ENV: 'test', PORT: '5000', MONGODB_URI: '', CLIENT_URL: 'http://localhost:5173',
    TERRAPULSE_ENGINE_ROOT: fixture.root, TERRAPULSE_FEATURES_ROOT: path.join(fixture.root, 'data/processed/features'),
    TERRAPULSE_SCHEMAS_ROOT: path.join(fixture.root, 'src/schemas') };
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  Object.assign(process.env, overrides);
  const runtime = loadEnv(), verifier = loadEnginePaths();
  assert.equal(runtime.engineRoot, fixture.root);
  assert.equal(runtime.engineRoot, verifier.engineRoot);
  assert.equal(runtime.featuresRoot, verifier.featuresRoot); assert.equal(runtime.schemasRoot, verifier.schemasRoot);
});
