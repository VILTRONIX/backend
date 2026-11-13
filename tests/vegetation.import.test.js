import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mapObservation, findConflicts, assertFingerprint, validateModisSources, planModisImport } from '../src/modules/vegetation/modis-import.service.js';
import { getVegetationObservationModel, vegetationObservationSchema, OBSERVATION_FIELDS } from '../src/modules/vegetation/vegetation-observation.model.js';
import { APPROVED_SOURCES, SOURCE_MAPPING, AOI_KEY } from '../src/modules/vegetation/vegetation.constants.js';
import { auditCsv, reconcileFiles } from '../scripts/auditModisSource.js';

// Small schema/logic fixtures, never written to a database or treated as NASA observations.
const context = () => ({ datasetId: new mongoose.Types.ObjectId(), studyAreaId: new mongoose.Types.ObjectId(), assetId: new mongoose.Types.ObjectId(), importedAt: new Date() });
function sourceRow(resolution, missing = false) {
  const row = resolution === 'monthly' ? { month: '2019-02', observation_count: 2, total_pixel_observations: 20 } : {
    date: '2019-02-02', total_pixel_count: 10, base_valid_pixel_count: 10, quality_valid_pixel_count: missing ? 0 : 5,
    vi_usefulness_distribution_before_filter: { 1: 10 }, vi_usefulness_distribution_after_filter: missing ? {} : { 1: 5 },
  };
  for (const prefix of ['ndvi', 'evi']) Object.assign(row, {
    [`${prefix}_mean`]: missing ? null : 0.24394132511430436,
    [`${prefix}_median`]: missing ? null : 0.2326, [`${prefix}_std`]: missing ? null : 0.04,
    [`${prefix}_valid_pixel_count`]: missing ? 0 : 5,
    [`${prefix}_valid_pixel_percentage`]: missing ? 0 : resolution === 'monthly' ? 25 : 50,
  });
  return row;
}

test('all source fields map explicitly, retaining decoded numbers and QA objects', async (t) => {
  const connection = mongoose.createConnection(); t.after(() => connection.close());
  const Model = getVegetationObservationModel(connection);
  for (const resolution of ['16day', 'monthly']) {
    const row = sourceRow(resolution), mapped = mapObservation(row, resolution, context());
    await new Model(mapped).validate();
    for (const [source, target] of Object.entries(SOURCE_MAPPING)) if (Object.hasOwn(row, source)) assert.deepEqual(mapped[target], row[source]);
    assert.equal(mapped.ndviMean, 0.24394132511430436);
    assert.equal(mapped.countyMaskApplied, false);
    assert.equal(mapped.exactCountyStatistics, false);
    assert.equal(mapped.countyCoverageStatus, 'unverified');
    assert.equal(mapped.aoiKey, AOI_KEY);
    assert.equal(mapped.periodKey, resolution === 'monthly' ? '2019-02' : '2019-02-02');
    assert.equal(mapped.observationDate.toISOString(), resolution === 'monthly' ? '2019-02-01T00:00:00.000Z' : '2019-02-02T00:00:00.000Z');
    if (resolution === 'monthly') { assert.equal(mapped.qualityValidPixelCount, undefined); assert.equal(mapped.month, '2019-02'); }
  }
});

test('zero valid pixels preserve all six null measurements and missing-data status', async (t) => {
  const connection = mongoose.createConnection(); t.after(() => connection.close());
  for (const resolution of ['16day', 'monthly']) {
    const mapped = mapObservation(sourceRow(resolution, true), resolution, context());
    await new (getVegetationObservationModel(connection))(mapped).validate();
    for (const prefix of ['ndvi', 'evi']) for (const suffix of ['Mean', 'Median', 'Std']) assert.equal(mapped[`${prefix}${suffix}`], null);
    assert.equal(mapped.ndviValidPixelCount, 0);
    assert.equal(mapped.ndviValidPixelPercentage, 0);
    assert.equal(mapped.missingDataStatus, 'no_valid_pixels');
  }
});

test('observation schema rejects invalid counts, percentages, dates, resolution fields, and false county claims', async (t) => {
  const connection = mongoose.createConnection(); t.after(() => connection.close());
  const Model = getVegetationObservationModel(connection);
  const mapped = mapObservation(sourceRow('16day'), '16day', context());
  for (const change of [{ ndviValidPixelCount: -1 }, { ndviValidPixelCount: 1.5 }, { ndviValidPixelPercentage: 101 }, { countyMaskApplied: true }, { exactCountyStatistics: true }, { countyCoverageStatus: 'verified' }, { observationDate: new Date('2019-02-03T00:00:00Z') }, { month: '2019-02' }, { missingDataStatus: 'no_valid_pixels' }]) {
    await assert.rejects(new Model({ ...mapped, ...change }).validate(), { name: 'ValidationError' });
  }
  const indexes = vegetationObservationSchema.indexes();
  assert.equal(indexes.length, 3);
  assert.deepEqual(indexes[0][0], { datasetId: 1, aoiKey: 1, resolution: 1, periodKey: 1 });
  assert.equal(indexes[0][1].unique, true);
});

test('source fingerprints, exact schemas, dates, counts, and null gates cannot be silently changed', () => {
  const approved = APPROVED_SOURCES['16day'];
  const source = { sha256: approved.checksum, sizeBytes: approved.sizeBytes, audit: { headers: approved.headers, rowCount: approved.rowCount, firstDate: approved.start, lastDate: approved.end,
    schema: ['ndvi', 'evi'].flatMap((prefix) => ['mean', 'median', 'std'].map((suffix) => ({ name: `${prefix}_${suffix}`, nullCount: 18 }))) } };
  assertFingerprint(source, approved, '16day');
  for (const change of [{ sha256: '0'.repeat(64) }, { sizeBytes: 1 }, { audit: { ...source.audit, headers: [...approved.headers].reverse() } }, { audit: { ...source.audit, rowCount: 206 } }, { audit: { ...source.audit, firstDate: '2018-01-01' } }]) assert.throws(() => assertFingerprint({ ...source, ...change }, approved, '16day'));
});

test('conflict comparison detects changed values, QA, hashes, or pilot references without overwriting', () => {
  const mapped = mapObservation(sourceRow('16day'), '16day', context());
  assert.deepEqual(findConflicts(mapped, { ...mapped, importedAt: new Date(0) }, [...OBSERVATION_FIELDS, 'contentHash'], 'test'), []);
  for (const field of ['ndviMean', 'sourceChecksum', 'studyAreaId', 'viUsefulnessDistributionAfterFilter']) {
    const changed = { ...mapped, [field]: field === 'ndviMean' ? 0.9 : null };
    assert.ok(findConflicts(mapped, changed, OBSERVATION_FIELDS, 'test').some((entry) => entry.field === field));
    assert.equal(mapped.ndviMean, 0.24394132511430436);
  }
});

test('ingestion parser converts NaN measurement markers to null but does not recompute monthly std', () => {
  const row = sourceRow('16day', true);
  const encode = (value) => value && typeof value === 'object' ? '"' + JSON.stringify(value).replaceAll('"', '""') + '"' : value == null ? 'NaN' : String(value);
  const headers = APPROVED_SOURCES['16day'].headers;
  const csv = headers.join(',') + '\n' + headers.map((key) => encode(row[key])).join(',') + '\n';
  const parsed = auditCsv(csv, '16day', { allowMeasurementNaN: true });
  assert.equal(parsed.records[0].ndviMean, undefined);
  assert.equal(parsed.records[0].ndvi_mean, null);
  assert.equal(parsed.invalidNumbers.length, 0);
  const result = reconcileFiles(parsed, { records: [], noData: [] }, { verifyPooledStd: false });
  assert.equal(result.maxAbsolutePooledStdDifference.ndvi, null);
});

test('source gate rejects missing root; command defaults to non-writing dry-run', async () => {
  await assert.rejects(validateModisSources(''), /TERRAPULSE_DATA_ROOT/);
  const entry = fileURLToPath(new URL('../scripts/ingestModis.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry], { env: { ...process.env, TERRAPULSE_DATA_ROOT: '' }, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /TERRAPULSE_DATA_ROOT/);
  assert.doesNotMatch(result.stdout, /commit-and-read-back/);
});

test('missing dataset context stops read-only planning without creating collections or writing', async (t) => {
  const connection = mongoose.createConnection(); t.after(() => connection.close());
  const Dataset = (await import('../src/modules/datasets/dataset.model.js')).getDatasetModel(connection);
  const Area = (await import('../src/modules/study-areas/study-area.model.js')).getStudyAreaModel(connection);
  const query = (value) => ({ select() { return this; }, lean() { return this; }, maxTimeMS: async () => value });
  Dataset.findOne = () => query(null); Area.find = () => query([]);
  await assert.rejects(planModisImport(connection, {}), /Existing active MODIS Dataset/);
});
