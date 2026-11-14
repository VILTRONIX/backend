import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { finalFixture, hash } from './helpers/engine-v1.js';
import { createEngineService } from '../src/modules/engine/engine.service.js';
import { FINAL_DATASET_IDS } from '../src/modules/engine/engine.contract-v1.js';
import { resolveEnginePaths } from '../src/config/features.js';

const service = (fixture, options = {}) => createEngineService({ engineRoot: fixture.root, ...options });

test('contract 1.0.0 maps all eight datasets, validates their schemas, and exposes safe metadata', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture), list = await engine.listDatasets();
  assert.equal(list.manifest.sourceContractVersion, '1.0.0');
  assert.equal(list.manifest.finalContractAgreement, 'supported');
  assert.equal(list.items.length, 8);
  for (const [name, id] of Object.entries(FINAL_DATASET_IDS)) {
    const dataset = list.items.find((entry) => entry.id === id);
    assert.equal(dataset.engineDatasetId, name);
    assert.equal(dataset.status, 'available', `${name}: ${dataset.reason}`);
    assert.equal(dataset.verification.scientific, 'not_assessed');
    assert.equal(dataset.recordCount, fixture.definitions[name].entry.row_count);
    assert.deepEqual(dataset.metadata.primaryKey, fixture.definitions[name].entry.primary_key);
    assert.equal(dataset.metadata.sourceMetadata.originalSourceVerification, 'not_independently_verified');
    assert.ok(dataset.metadata.limitations.includes('SYNTHETIC TEST DATA ONLY'));
    assert.equal(dataset.provenance.files[0].format, 'csv');
  }
  const text = JSON.stringify(list);
  assert.ok(!text.includes(fixture.root));
  assert.doesNotMatch(text, /schema_path|source_path|synthetic-originals|src\/schemas/);
});

test('CSV strings, escaped commas/quotes, nulls, booleans and histogram strings retain declared types', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture);
  const soil = await engine.readDataset('soil_map_units');
  assert.equal(soil.items[0].mukey, '001');
  assert.equal(soil.items[0].muname, 'Synthetic "quoted", map unit');
  assert.equal(soil.items[1].dominant_texture, null);
  assert.equal(soil.items[0].root_zone_aws_0_150cm_mm, null);
  const modis = await engine.readDataset('modis_16day');
  assert.equal(typeof modis.items[0].vi_usefulness_distribution_before_filter, 'string');
  assert.equal(modis.items[1].ndvi_mean, null);
  const power = await engine.readDataset('power_monthly');
  assert.equal(power.items[0].complete, true);
  assert.equal(typeof power.items[0].year, 'number');
  fixture.forLogicalId('power_monthly').rows[0].days_present = 30;
  fixture.forLogicalId('power_monthly').rows[0].complete = false;
  await fixture.publish();
  assert.equal((await engine.readDataset('power_monthly')).items[0].complete, false);
});

for (const [label, id, mutate, reason] of [
  ['invalid boolean', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows[0].complete = 'false'; }, 'invalid_csv_boolean'],
  ['nonnullable null', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows[0].year = null; }, 'nonnullable_csv_null'],
  ['non-finite number', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows[0].sample_value = '1e999'; }, 'invalid_csv_number'],
  ['unsafe integer', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows[0].year = '9007199254740992'; }, 'invalid_csv_number'],
  ['wrong date', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows[0].month_start = '2020-02-30'; }, 'invalid_record'],
  ['duplicate key', 'power_monthly', (f) => { const d = f.forLogicalId('power_monthly'); d.rows[1] = { ...d.rows[0] }; }, 'duplicate_primary_key'],
  ['wrong count', 'power_monthly', (f) => { f.forLogicalId('power_monthly').rows.pop(); }, 'record_count_mismatch'],
  ['bad QA content', 'modis_16day', (f) => { f.forLogicalId('modis_16day').rows[0].vi_usefulness_distribution_after_filter = '{"0":-1}'; }, 'invalid_record'],
  ['QA count mismatch', 'modis_16day', (f) => { f.forLogicalId('modis_16day').rows[0].vi_usefulness_distribution_after_filter = '{"0":4}'; }, 'modis_qa_mismatch'],
  ['missing-count mismatch', 'soil_map_units', (f) => { f.forLogicalId('soil_map_units').rows[1].dominant_texture = 'synthetic'; }, 'missing_count_mismatch'],
  ['wrong percentage', 'usda_annual', (f) => { f.forLogicalId('usda_annual').rows[0].area_pct = 90; }, 'crop_area_or_percentage_mismatch'],
  ['wrong pixel area', 'usda_crop_classes', (f) => { f.forLogicalId('usda_crop_classes').rows[0].pixel_count = 2; }, 'crop_class_area_mismatch'],
  ['wrong year pair', 'usda_crop_transitions', (f) => { f.forLogicalId('usda_crop_transitions').rows[0].year_2 = 2022; }, 'transition_year_mismatch'],
  ['non-month label', 'merra2_context', (f) => { f.forLogicalId('merra2_context').rows[0].date = '2020-01-02'; }, 'merra_month_label_mismatch'],
]) {
  test(`final integrity rejects ${label} before availability`, async (t) => {
    const fixture = await finalFixture(t); mutate(fixture); await fixture.publish();
    const dataset = await service(fixture).getDataset(id);
    assert.equal(dataset.structurallyReady, false);
    assert.equal(dataset.reason, reason);
  });
}

test('CSV output and schema hash mismatches block availability independently', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture), d = fixture.forLogicalId('power_monthly');
  d.entry.output_sha256 = '0'.repeat(64); await fixture.writeManifest();
  assert.equal((await engine.getDataset('power_monthly')).reason, 'output_checksum_mismatch');
  await fixture.publish();
  await writeFile(path.join(fixture.root, d.entry.schema_path), '{}');
  assert.equal((await engine.getDataset('power_monthly')).reason, 'schema_checksum_mismatch');
});

test('headers and row widths are checked even if a new manifest hash matches malformed CSV bytes', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture), d = fixture.forLogicalId('power_monthly');
  const file = path.join(fixture.root, d.entry.path), original = await readFile(file, 'utf8');
  for (const [bytes, reason] of [[original.replace('location_id,', 'wrong_header,'), 'csv_header_mismatch'], [original.replace('synthetic-A,1,2', 'synthetic-A,1'), 'invalid_csv_structure_or_encoding']]) {
    await writeFile(file, bytes); d.entry.output_sha256 = hash(bytes); await fixture.writeManifest();
    assert.equal((await engine.getDataset('power_monthly')).reason, reason);
  }
});

test('all dataset filters and pagination operate on original records without rewriting them', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture);
  for (const [id, query, total] of [
    ['power_monthly', { location_id: 'synthetic-A', year: '2020', month: '2' }, 1],
    ['power_monthly', { startDate: '2020-02', endDate: '2020-02' }, 2],
    ['modis_monthly', { month: '2020-02' }, 1],
    ['modis_monthly', { year: '2020', startDate: '2020-02', endDate: '2020-02' }, 1],
    ['modis_16day', { startDate: '2021-01-01', endDate: '2021-01-01' }, 1],
    ['usda_annual', { year: '2020', crop_code: '999' }, 1], ['usda_crop_classes', { crop_code: '2' }, 1],
    ['usda_crop_transitions', { year_1: '2020', year_2: '2021', transition_type: 'Corn -> Soybeans' }, 1],
    ['soil_map_units', { mukey: '001' }, 1], ['soil_map_units', { mapUnit: '001' }, 1],
    ['merra2_context', { latitude: '42', longitude: '-93.125', startDate: '2020-02', endDate: '2020-02' }, 1],
    ['merra2_context', { year: '2020', endDate: '2020-01-01' }, 2],
  ]) assert.equal((await engine.readDataset(id, query)).pagination.total, total, id + JSON.stringify(query));
  const paged = await engine.readDataset('power_monthly', { page: '2', limit: '1' });
  assert.equal(paged.pagination.total, 4);
  assert.equal(paged.items[0].month, 2);
  assert.equal(paged.items[0].month_start, '2020-02-01');
  assert.deepEqual((await engine.readDataset('soil_map_units', { mukey: '999' })).items, []);
});

test('dataset query validation rejects inappropriate filters and preserves page limits', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture);
  for (const [id, query] of [
    ['power_monthly', { month: '13' }], ['power_monthly', { location_id: ['a', 'b'] }],
    ['modis_monthly', { month: '2020-13' }], ['modis_monthly', { startDate: '2020-01-01' }],
    ['modis_16day', { startDate: '2020-01' }], ['soil_map_units', { year: '2020' }],
    ['soil_map_units', { mukey: '001', mapUnit: '002' }], ['soil_map_units', { mukey: '../x' }],
    ['usda_crop_transitions', { year: '2020' }], ['usda_crop_transitions', { year_1: '2020', year_2: '2022' }],
    ['usda_annual', { crop_code: '1.5' }], ['merra2_context', { longitude: '-Infinity' }],
    ['merra2_context', { latitude: '91' }], ['power_monthly', { limit: '101' }],
  ]) await assert.rejects(engine.readDataset(id, query), (error) => error.code === 'INVALID_ENGINE_QUERY');
});

test('optional MERRA-2 absence does not block any required dataset', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture);
  await unlink(path.join(fixture.root, fixture.forLogicalId('merra2_context').entry.path));
  const list = await engine.listDatasets();
  assert.ok(list.items.filter((entry) => !entry.optional).every((entry) => entry.status === 'available'));
  assert.equal(list.items.find((entry) => entry.optional).status, 'missing_file');
  fixture.manifest.datasets = fixture.manifest.datasets.filter((entry) => !entry.optional); await fixture.writeManifest();
  assert.equal((await engine.getDataset('merra2_context')).reason, 'dataset_not_declared');
});

test('repository-relative references cannot escape independent feature/schema roots', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture), d = fixture.forLogicalId('power_monthly');
  for (const reference of ['../private.csv', '/private.csv', 'data/processed/features/../private.csv', 'data/processed/other/file.csv', 'C:/private.csv']) {
    d.entry.path = reference; await fixture.writeManifest();
    assert.equal((await engine.getDataset('power_monthly')).structurallyReady, false);
  }
  const paths = resolveEnginePaths({ TERRAPULSE_ENGINE_ROOT: fixture.root });
  assert.equal(paths.featuresRoot, path.join(fixture.root, 'data/processed/features'));
  assert.equal(paths.schemasRoot, path.join(fixture.root, 'src/schemas'));
  const outside = await finalFixture(t);
  d.entry.path = 'data/processed/features/nasa_power_monthly_features.csv';
  await symlink(path.join(outside.root, 'src/schemas'), path.join(paths.schemasRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  d.entry.schema_path = 'src/schemas/escape/nasa_power_monthly_features.schema.json'; await fixture.writeManifest();
  assert.equal((await engine.getDataset('power_monthly')).reason, 'unsafe_reference');
});

test('independent root overrides and legacy features-root-only configuration remain supported', async (t) => {
  const fixture = await finalFixture(t), paths = resolveEnginePaths({ TERRAPULSE_ENGINE_ROOT: fixture.root });
  const engine = createEngineService({ featuresRoot: paths.featuresRoot, schemasRoot: paths.schemasRoot });
  assert.equal((await engine.getDataset('power_monthly')).status, 'available');
  for (const name of ['TERRAPULSE_ENGINE_ROOT', 'TERRAPULSE_FEATURES_ROOT', 'TERRAPULSE_SCHEMAS_ROOT']) {
    assert.throws(() => resolveEnginePaths({ [name]: '../private' }), (error) => error.message.includes(name) && !error.message.includes('private'));
  }
});

test('unsupported versions, coverage mismatches, malformed schemas, and CSV byte limits fail closed', async (t) => {
  const fixture = await finalFixture(t), engine = service(fixture), d = fixture.forLogicalId('power_monthly');
  fixture.manifest.contract_version = '1.1.0'; await fixture.writeManifest();
  assert.equal((await engine.getDataset('power_monthly')).reason, 'unsupported_manifest_contract');
  fixture.manifest.contract_version = '1.0.0';
  d.entry.coverage.end = '2020-03'; d.schema['x-dataset'].validation.coverage.end = '2020-03'; await fixture.publish();
  assert.equal((await engine.getDataset('power_monthly')).reason, 'coverage_mismatch');
  d.entry.coverage.end = '2020-02'; d.schema['x-dataset'].validation.coverage.end = '2020-02';
  d.schema.properties.sample_value.type = 'unknown'; await fixture.publish();
  assert.equal((await engine.getDataset('power_monthly')).status, 'invalid_schema');
  d.schema.properties.sample_value.type = 'number'; await fixture.publish();
  assert.equal((await service(fixture, { limits: { csvBytes: 10 } }).getDataset('power_monthly')).reason, 'csv_size_limit');
});
