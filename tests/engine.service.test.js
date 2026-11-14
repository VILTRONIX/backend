import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { engineFixture } from './helpers/engine.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { FORMAT_ADAPTERS } from '../src/modules/engine/engine.loaders.js';
import { validateReference } from '../src/modules/engine/engine.files.js';

const serviceFor = (fixture, options = {}) => createEngineService({ featuresRoot: fixture.root, ...options });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('valid manifest discovers all eight logical definitions without making optional MERRA-2 a blocker', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  const list = await service.listDatasets();
  assert.equal(list.manifest.status, 'available');
  assert.equal(list.manifest.finalContractAgreement, 'pending');
  assert.equal(list.items.length, 8);
  const dataset = list.items.find(({ id }) => id === 'power_monthly');
  assert.equal(dataset.status, 'available');
  assert.equal(dataset.structurallyReady, true);
  assert.deepEqual(dataset.verification, { file: 'verified', schema: 'verified', records: 'verified', scientific: 'not_assessed' });
  assert.equal(dataset.recordCount, 4);
  assert.equal(dataset.provenance.files[0].checksum, hash(await readFile(path.join(fixture.root, 'samples.ndjson'))));
  assert.equal(dataset.provenance.files[0].schemaChecksum, hash(await readFile(path.join(fixture.root, 'record.schema.json'))));
  assert.deepEqual(dataset.metadata.limitations, fixture.manifest.datasets[0].metadata.limitations);
  const merra = list.items.find(({ id }) => id === 'merra2_context');
  assert.equal(merra.optional, true);
  assert.equal(merra.status, 'missing_file');
  assert.equal(merra.reason, 'dataset_not_declared');
  assert.equal((await service.readDataset('power_monthly')).items.length, 4);
});

test('missing manifest yields honest catalog statuses and read errors without creating output', async (t) => {
  const fixture = await engineFixture(t);
  await unlink(path.join(fixture.root, 'feature_manifest.json'));
  const service = serviceFor(fixture);
  assert.ok((await service.listDatasets()).items.every(({ status, structurallyReady }) => status === 'missing_manifest' && !structurallyReady));
  await assert.rejects(service.readDataset('power_monthly'), (error) => error.status === 503 && error.details.status === 'missing_manifest');
  assert.equal((await service.getDataset('merra2_context')).status, 'missing_manifest');
});

for (const [label, change, status, reason] of [
  ['missing file', async (f) => unlink(path.join(f.root, 'samples.ndjson')), 'missing_file', 'missing_file'],
  ['missing schema', async (f) => unlink(path.join(f.root, 'record.schema.json')), 'schema_missing', 'schema_missing'],
  ['missing schema reference', async (f) => { delete f.manifest.datasets[0].files[0].schema; await f.writeManifest(); }, 'schema_missing', 'schema_reference_missing'],
  ['invalid schema JSON', async (f) => writeFile(path.join(f.root, 'record.schema.json'), '{'), 'invalid_schema', 'invalid_json_document'],
  ['unsupported schema keyword', async (f) => { f.schema.properties.sample_value.multipleOf = 2; await f.writeSchema(); }, 'invalid_schema', 'unsupported_schema'],
  ['invalid record', async (f) => { f.records[3].sample_value = 'not-numeric'; await f.writeRecords(); }, 'validation_failed', 'invalid_record'],
  ['invalid mapped period', async (f) => { f.records[3].sample_period = '2020-13'; await f.writeRecords(); }, 'validation_failed', 'invalid_record'],
  ['missing record field', async (f) => { delete f.records[0].sample_key; await f.writeRecords(); }, 'validation_failed', 'invalid_record'],
  ['empty NDJSON', async (f) => writeFile(path.join(f.root, 'samples.ndjson'), ' \r\n\n'), 'validation_failed', 'empty_dataset'],
  ['invalid data JSON', async (f) => writeFile(path.join(f.root, 'samples.ndjson'), '{'), 'validation_failed', 'invalid_data_encoding_or_json'],
  ['missing metadata', async (f) => { delete f.manifest.datasets[0].metadata.spatialScope; await f.writeManifest(); }, 'validation_failed', 'required_metadata_missing_or_invalid'],
  ['unsupported format', async (f) => { f.manifest.datasets[0].files[0].format = 'parquet'; await f.writeManifest(); }, 'unsupported_format', 'format_adapter_unavailable'],
  ['undeclared mapping', async (f) => { f.manifest.datasets[0].fieldMappings.year = 'not_a_column'; await f.writeManifest(); }, 'invalid_schema', 'mapping_not_declared_in_schema'],
]) {
  test(`dataset availability reports ${label} without returning partial records`, async (t) => {
    const fixture = await engineFixture(t); await change(fixture);
    const service = serviceFor(fixture), dataset = await service.getDataset('power_monthly');
    assert.equal(dataset.status, status);
    assert.equal(dataset.reason, reason);
    assert.equal(dataset.structurallyReady, false);
    if (reason === 'required_metadata_missing_or_invalid') {
      assert.equal(dataset.verification.file, 'pending');
      assert.equal(dataset.verification.records, 'pending');
    }
    await assert.rejects(service.readDataset('power_monthly', { limit: '1' }), (error) => error.code === 'ENGINE_DATASET_UNAVAILABLE' && error.details.status === status);
  });
}

test('JSON array and streaming NDJSON adapters return equivalent unmodified records and retain nulls', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  const ndjson = await service.readDataset('power_monthly');
  fixture.manifest.datasets[0].files[0].path = 'samples.json';
  fixture.manifest.datasets[0].files[0].format = 'json'; await fixture.writeManifest();
  const json = await service.readDataset('power_monthly');
  assert.deepEqual(json.items, ndjson.items);
  assert.deepEqual(json.items, fixture.records);
  assert.equal(json.items[1].sample_value, null);
  await writeFile(path.join(fixture.root, 'samples.json'), '[]');
  assert.equal((await service.getDataset('power_monthly')).reason, 'empty_dataset');
  await writeFile(path.join(fixture.root, 'samples.json'), '{}');
  assert.equal((await service.getDataset('power_monthly')).reason, 'json_array_required');
});

test('pagination and inclusive mapped date/year/map-unit filters scan and validate all source records', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  const page = await service.readDataset('power_monthly', { page: '2', limit: '2' });
  assert.deepEqual(page.items, fixture.records.slice(2));
  assert.deepEqual(page.pagination, { page: 2, limit: 2, total: 4, totalPages: 2 });
  assert.deepEqual((await service.readDataset('power_monthly', { startDate: '2020-02', endDate: '2020-03' })).items, fixture.records.slice(1, 3));
  assert.equal((await service.readDataset('power_monthly', { year: '2020' })).pagination.total, 3);
  assert.equal((await service.readDataset('power_monthly', { startYear: '2021', endYear: '2021' })).pagination.total, 1);
  assert.equal((await service.readDataset('power_monthly', { mapUnit: 'synthetic-u1' })).pagination.total, 2);
  const empty = await service.readDataset('power_monthly', { year: '2030' });
  assert.equal(empty.dataset.status, 'available');
  assert.deepEqual(empty.items, []);
  assert.equal(empty.pagination.total, 0);
  assert.deepEqual((await service.readDataset('power_monthly', { page: '100', limit: '100' })).items, []);
});

test('queries reject invalid types, operators, ranges, unsupported filters, and incorrect date precision', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  for (const query of [{ page: '0' }, { limit: '101' }, { page: ['1', '2'] }, { year: '2020', startYear: '2020' },
    { year: 'NaN' }, { startYear: '2021', endYear: '2020' }, { startDate: '2020-13' }, { startDate: '2020-02-30' },
    { startDate: '2020-02-01' }, { startDate: '2021-01', endDate: '2020-01' }, { mapUnit: {} }, { extra: 'x' }]) {
    await assert.rejects(service.readDataset('power_monthly', query), (error) => error.code === 'INVALID_ENGINE_QUERY');
  }
  fixture.manifest.datasets[0].fieldMappings = {}; await fixture.writeManifest();
  await assert.rejects(service.readDataset('power_monthly', { year: '2020' }), (error) => error.code === 'INVALID_ENGINE_QUERY');
});

test('path references reject traversal, absolute paths, encoded paths, Windows streams, and malformed segments', async (t) => {
  for (const reference of ['../private', '/private', 'C:/private', 'C:\\private', '\\\\server\\private',
    'nested/../../private', 'nested//file', './file', 'nested/%2e%2e/private', 'file:stream', 'file\0.json']) {
    assert.throws(() => validateReference(reference), (error) => error.reason === 'unsafe_reference');
  }
  const fixture = await engineFixture(t);
  fixture.manifest.datasets[0].files[0].path = '../private-secret'; await fixture.writeManifest();
  assert.equal((await serviceFor(fixture).getDataset('power_monthly')).reason, 'unsafe_reference');
  fixture.manifest.datasets[0].files[0].path = 'samples.ndjson';
  fixture.manifest.datasets[0].files[0].schema = '../private-schema'; await fixture.writeManifest();
  assert.equal((await serviceFor(fixture).getDataset('power_monthly')).reason, 'unsafe_reference');
});

test('realpath containment rejects directory links escaping the configured root', async (t) => {
  const fixture = await engineFixture(t), outside = await engineFixture(t);
  await symlink(outside.root, path.join(fixture.root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  fixture.manifest.datasets[0].files[0].path = 'escape/samples.ndjson'; await fixture.writeManifest();
  assert.equal((await serviceFor(fixture).getDataset('power_monthly')).reason, 'unsafe_reference');
});

test('malformed, duplicate, unknown, or unagreed manifests fail closed; explicit adapters can transform an upstream shape', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  for (const value of [null, {}, { contractVersion: 'unagreed', datasets: [] },
    { ...fixture.manifest, datasets: [fixture.manifest.datasets[0], fixture.manifest.datasets[0]] },
    { ...fixture.manifest, datasets: [{ ...fixture.manifest.datasets[0], logicalId: 'smap' }] }]) {
    await writeFile(path.join(fixture.root, 'feature_manifest.json'), JSON.stringify(value));
    assert.equal((await service.getDataset('power_monthly')).status, 'validation_failed');
  }
  await writeFile(path.join(fixture.root, 'feature_manifest.json'), '{');
  assert.equal((await service.listDatasets()).manifest.reason, 'invalid_json_document');
  await writeFile(path.join(fixture.root, 'feature_manifest.json'), '{"syntheticUpstreamShape":true}');
  const adapted = serviceFor(fixture, { manifestAdapter: (raw) => raw.syntheticUpstreamShape ? fixture.manifest : raw });
  assert.equal((await adapted.getDataset('power_monthly')).status, 'available');
});

test('every shard is required and invalid records after the requested page still block results', async (t) => {
  const fixture = await engineFixture(t);
  fixture.manifest.datasets[0].files.push({ id: 'synthetic-shard-2', path: 'second.ndjson', format: 'ndjson', schema: 'record.schema.json' });
  await fixture.writeManifest();
  const service = serviceFor(fixture);
  assert.equal((await service.getDataset('power_monthly')).status, 'missing_file');
  await writeFile(path.join(fixture.root, 'second.ndjson'), JSON.stringify(fixture.records[0]));
  assert.equal((await service.readDataset('power_monthly', { limit: '1' })).pagination.total, 5);
  const firstBytes = (await readFile(path.join(fixture.root, 'samples.ndjson'))).length;
  assert.equal((await serviceFor(fixture, { limits: { datasetBytes: firstBytes } }).getDataset('power_monthly')).reason, 'dataset_size_limit');
  await writeFile(path.join(fixture.root, 'second.ndjson'), '{"sample_value":"invalid"}');
  await assert.rejects(service.readDataset('power_monthly', { limit: '1' }), (error) => error.details.reason === 'invalid_record');
});

test('source changes and subsequent corruption are detected instead of serving cached readiness', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  assert.equal((await service.getDataset('power_monthly')).status, 'available');
  const changing = serviceFor(fixture, { adapters: {
    ...FORMAT_ADAPTERS,
    ndjson: async (...args) => {
      const result = await FORMAT_ADAPTERS.ndjson(...args);
      await writeFile(path.join(fixture.root, 'samples.ndjson'), 'changed synthetic test content');
      return result;
    },
  } });
  assert.equal((await changing.getDataset('power_monthly')).reason, 'source_changed');
  assert.equal((await service.getDataset('power_monthly')).reason, 'invalid_data_encoding_or_json');
});

test('streamed NDJSON handles multiple chunks, UTF-8, CRLF, blank lines, and no final newline', async (t) => {
  const fixture = await engineFixture(t);
  const rows = Array.from({ length: 1000 }, (_, index) => ({ ...fixture.records[0], sample_key: `synthetic-😀-${index}` }));
  await writeFile(path.join(fixture.root, 'samples.ndjson'), '\r\n' + rows.map((row) => JSON.stringify(row)).join('\r\n'));
  const result = await serviceFor(fixture).readDataset('power_monthly', { page: '10', limit: '100' });
  assert.equal(result.pagination.total, 1000);
  assert.deepEqual(result.items, rows.slice(900));
});

test('invalid UTF-8 and non-finite decoded values fail record loading', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  await writeFile(path.join(fixture.root, 'samples.ndjson'), Buffer.from([123, 34, 255, 34, 58, 49, 125]));
  assert.equal((await service.getDataset('power_monthly')).reason, 'invalid_data_encoding_or_json');
  await writeFile(path.join(fixture.root, 'samples.ndjson'), JSON.stringify(fixture.records[0]).replace('"sample_value":1', '"sample_value":1e999'));
  assert.equal((await service.getDataset('power_monthly')).reason, 'invalid_record');
});

test('schema or manifest changes during scanning invalidate the complete dataset response', async (t) => {
  const fixture = await engineFixture(t);
  for (const target of ['record.schema.json', 'feature_manifest.json']) {
    await fixture.writeManifest(); await fixture.writeSchema();
    const changing = serviceFor(fixture, { adapters: {
      ...FORMAT_ADAPTERS,
      ndjson: async (...args) => {
        const result = await FORMAT_ADAPTERS.ndjson(...args);
        await writeFile(path.join(fixture.root, target), '{}');
        return result;
      },
    } });
    assert.equal((await changing.getDataset('power_monthly')).reason, 'source_changed');
  }
});

test('resource limits bound records, JSON buffers, streamed lines, schema and manifest size', async (t) => {
  const fixture = await engineFixture(t);
  for (const [limits, reason] of [
    [{ records: 1 }, 'record_count_limit'], [{ recordBytes: 10 }, 'record_size_limit'],
    [{ datasetBytes: 10 }, 'dataset_size_limit'], [{ schemaBytes: 10 }, 'document_too_large'],
    [{ manifestBytes: 10 }, 'document_too_large'],
  ]) assert.equal((await serviceFor(fixture, { limits }).getDataset('power_monthly')).reason, reason);
  fixture.manifest.datasets[0].files[0].path = 'samples.json';
  fixture.manifest.datasets[0].files[0].format = 'json'; await fixture.writeManifest();
  assert.equal((await serviceFor(fixture, { limits: { jsonBytes: 10 } }).getDataset('power_monthly')).reason, 'json_size_limit');
});

test('all discovery and reading operations preserve fixture bytes and do not expose private file references', async (t) => {
  const fixture = await engineFixture(t), service = serviceFor(fixture);
  fixture.manifest.datasets[0].metadata.storageUri = 'private-storage-marker'; await fixture.writeManifest();
  fixture.manifest.datasets[0].fieldMappings.date.private = 'private-mapping-marker'; await fixture.writeManifest();
  const files = ['feature_manifest.json', 'record.schema.json', 'samples.ndjson', 'samples.json'];
  const before = await Promise.all(files.map((file) => readFile(path.join(fixture.root, file))));
  const payloads = [await service.listDatasets(), await service.getDataset('power_monthly'), await service.readDataset('power_monthly')];
  assert.doesNotMatch(JSON.stringify(payloads), /private-storage-marker|private-mapping-marker|samples\.ndjson|record\.schema\.json/);
  assert.ok(!JSON.stringify(payloads).includes(fixture.root));
  for (let index = 0; index < files.length; index++) assert.deepEqual(await readFile(path.join(fixture.root, files[index])), before[index]);
});
