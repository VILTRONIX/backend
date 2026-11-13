import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import { auditSources } from '../../../scripts/auditModisSource.js';
import { getDatasetModel } from '../datasets/dataset.model.js';
import { getDatasetAssetModel } from '../datasets/dataset-asset.model.js';
import { getStudyAreaModel } from '../study-areas/study-area.model.js';
import { getVegetationObservationModel, OBSERVATION_FIELDS } from './vegetation-observation.model.js';
import { APPROVED_SOURCES, AOI_KEY, MODIS_SLUG, PILOT_GEOID, SPATIAL_PROVENANCE, SOURCE_MAPPING, PROCESSING_METADATA, LIMITATIONS } from './vegetation.constants.js';

export class ModisImportError extends Error {
  constructor(message, details) { super(message); this.details = details; }
}
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (value?._bsontype === 'ObjectId') return String(value);
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])]));
  return value;
}
const view = (value, fields) => canonical(Object.fromEntries(fields.filter((field) => value[field] !== undefined).map((field) => [field, value[field]])));
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function assertFingerprint(source, approved, resolution) {
  if (source.sha256 !== approved.checksum) throw new ModisImportError(`SHA-256 mismatch for ${resolution}; ingestion aborted.`, { resolution, expected: approved.checksum, actual: source.sha256 });
  if (source.sizeBytes !== approved.sizeBytes) throw new ModisImportError(`File size mismatch for ${resolution}; ingestion aborted.`);
  if (!isDeepStrictEqual(source.audit.headers, approved.headers)) throw new ModisImportError(`Exact source header order differs for ${resolution}.`);
  if (source.audit.rowCount !== approved.rowCount || source.audit.firstDate !== approved.start || source.audit.lastDate !== approved.end) throw new ModisImportError(`Count or date-range mismatch for ${resolution}.`);
  for (const prefix of ['ndvi', 'evi']) for (const suffix of ['mean', 'median', 'std']) {
    if (source.audit.schema.find((column) => column.name === `${prefix}_${suffix}`)?.nullCount !== approved.nullCount) throw new ModisImportError(`Null-count mismatch for ${resolution} ${prefix}_${suffix}.`);
  }
}

export async function validateModisSources(dataRoot = process.env.TERRAPULSE_DATA_ROOT) {
  if (!dataRoot || !path.isAbsolute(dataRoot)) throw new ModisImportError('Set TERRAPULSE_DATA_ROOT to an absolute directory before ingestion; no fallback is used.');
  // Pin the bytes before parsing, then reuse the audited parser and reconciliation without
  // recalculating monthly medians or standard deviations. Only weighted means are reconciled.
  for (const [resolution, approved] of Object.entries(APPROVED_SOURCES)) {
    let bytes;
    try {
      const file = path.join(dataRoot, 'processed', 'modis', approved.fileName);
      await access(file, constants.R_OK);
      bytes = await readFile(file);
    } catch { throw new ModisImportError(`Missing or unreadable ${resolution} CSV under TERRAPULSE_DATA_ROOT.`); }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== approved.checksum || bytes.length !== approved.sizeBytes) throw new ModisImportError(`Approved fingerprint mismatch for ${resolution}; no database writes are allowed.`, { resolution, expectedChecksum: approved.checksum, actualChecksum: actual, expectedBytes: approved.sizeBytes, actualBytes: bytes.length });
  }
  let audit;
  try { audit = await auditSources(dataRoot, { allowMeasurementNaN: true, verifyPooledStd: false }); }
  catch { throw new ModisImportError('Source parsing/audit failed. Inspect the approved CSV schemas and source availability.'); }
  const sources = { '16day': audit.composite, monthly: audit.monthly };
  for (const [resolution, source] of Object.entries(sources)) assertFingerprint(source, APPROVED_SOURCES[resolution], resolution);
  if (!audit.passed || !audit.composite.audit.zeroQualityEqualsNoData || audit.reconciliation.observationCountSum !== 207) throw new ModisImportError('Source validation gates failed; ingestion aborted.', {
    compositeErrors: audit.composite.audit.errors.length, monthlyErrors: audit.monthly.audit.errors.length,
    reconciliationErrors: audit.reconciliation.errors.length, sourceIntegrityErrors: audit.integrityErrors.length,
  });
  return { sources, reconciliation: audit.reconciliation, validatedAt: new Date() };
}

export function mapObservation(row, resolution, { datasetId, studyAreaId, assetId, importedAt }) {
  const periodKey = resolution === 'monthly' ? row.month : row.date;
  const mapped = Object.fromEntries(Object.entries(SOURCE_MAPPING).filter(([source]) => Object.hasOwn(row, source)).map(([source, target]) => [target, row[source]]));
  const empty = [row.ndvi_mean, row.evi_mean].filter((value) => value === null).length;
  const document = {
    datasetId, studyAreaId, areaGeoid: PILOT_GEOID, aoiKey: AOI_KEY, ...SPATIAL_PROVENANCE,
    resolution, periodKey, observationDate: new Date(`${periodKey}${resolution === 'monthly' ? '-01' : ''}T00:00:00Z`),
    ...(resolution === 'monthly' ? { month: row.month } : {}), ...mapped,
    missingDataStatus: empty === 2 ? 'no_valid_pixels' : empty ? 'partial' : 'available',
    sourceAssetId: assetId, sourceFile: APPROVED_SOURCES[resolution].fileName,
    sourceChecksum: APPROVED_SOURCES[resolution].checksum,
    processingMetadata: structuredClone(PROCESSING_METADATA), importedAt,
  };
  return { ...document, contentHash: digest(view(document, OBSERVATION_FIELDS)) };
}

const ASSET_FIELDS = ['datasetId', 'assetKey', 'assetType', 'fileName', 'format', 'sizeBytes', 'checksum', 'checksumAlgorithm', 'storageType', 'storageUri', 'dateStart', 'dateEnd', 'timezone', 'crs', 'variables', 'validationStatus', 'processingStatus', 'metadata'];
function assetDocument(source, resolution, datasetId, id, now) {
  const approved = APPROVED_SOURCES[resolution];
  return {
    _id: id, datasetId, assetKey: `${AOI_KEY}:${resolution}`, assetType: 'processed', fileName: approved.fileName,
    format: 'CSV', sizeBytes: source.sizeBytes, checksum: source.sha256, checksumAlgorithm: 'sha256',
    storageType: 'local', storageUri: source.path, discoveredAt: now,
    dateStart: approved.start, dateEnd: approved.end, timezone: 'unknown', crs: null,
    variables: ['NDVI', 'EVI'], validationStatus: 'validated', processingStatus: 'completed',
    metadata: { aoiKey: AOI_KEY, resolution, recordCount: approved.rowCount, headers: source.audit.headers,
      ...SPATIAL_PROVENANCE, processing: structuredClone(PROCESSING_METADATA),
      reportReference: 'reports/modis_backend_source_audit.md', rawNetcdfLocallyVerified: false },
    createdAt: now, updatedAt: now,
  };
}
export function findConflicts(expected, existing, fields, label) {
  return fields.filter((field) => !isDeepStrictEqual(canonical(expected[field]), canonical(existing[field]))).map((field) => ({ record: label, field }));
}
const sessionQuery = (query, session) => session ? query.session(session) : query;
async function indexesOf(Model) {
  try { return await Model.listIndexes(); } catch (error) { if (error.code === 26) return []; throw error; }
}
async function assertIndexCompatibility(Model) {
  const actual = await indexesOf(Model);
  for (const [key, options] of Model.schema.indexes()) for (const index of actual) {
    if (index.name === options.name && (!isDeepStrictEqual(index.key, key) || Boolean(index.unique) !== Boolean(options.unique) || !isDeepStrictEqual(index.partialFilterExpression, options.partialFilterExpression))) throw new ModisImportError(`Index conflict in ${Model.collection.collectionName}: ${options.name}.`);
    if (isDeepStrictEqual(index.key, key) && index.name !== options.name) throw new ModisImportError(`Equivalent keys use a different index name in ${Model.collection.collectionName}; review before import.`);
  }
}

export async function planModisImport(connection, sourcePlan, { session } = {}) {
  const Dataset = getDatasetModel(connection), Asset = getDatasetAssetModel(connection), Area = getStudyAreaModel(connection), Observation = getVegetationObservationModel(connection);
  const dataset = await sessionQuery(Dataset.findOne({ slug: MODIS_SLUG }).lean().maxTimeMS(5000), session);
  const areas = await sessionQuery(Area.find({ geoid: PILOT_GEOID, countryCode: 'US', areaType: 'county', isActive: true }).select('_id name geoid').lean().maxTimeMS(5000), session);
  if (!dataset || !dataset.isActive || areas.length !== 1) throw new ModisImportError('Existing active MODIS Dataset and exactly one Story County pilot StudyArea are required; no records will be created for them.');
  if (!session) { await assertIndexCompatibility(Asset); await assertIndexCompatibility(Observation); }
  const area = areas[0];
  const storedAssets = await sessionQuery(Asset.find({ $or: [{ datasetId: dataset._id }, { assetKey: { $in: [`${AOI_KEY}:16day`, `${AOI_KEY}:monthly`] } }] }).select('+storageUri +metadata').lean().maxTimeMS(5000), session);
  const existing = await sessionQuery(Observation.find({ datasetId: dataset._id, aoiKey: AOI_KEY }).lean().maxTimeMS(5000), session);
  const now = new Date(), assets = [], observations = [], conflicts = [];
  for (const resolution of ['16day', 'monthly']) {
    const source = sourcePlan.sources[resolution];
    const candidates = storedAssets.filter((asset) => asset.assetKey === `${AOI_KEY}:${resolution}` || asset.fileName === APPROVED_SOURCES[resolution].fileName || asset.checksum === source.sha256);
    if (candidates.length > 1) throw new ModisImportError(`Multiple existing assets match ${resolution}; duplicate review is required.`);
    const stored = candidates[0];
    const value = assetDocument(source, resolution, dataset._id, stored?._id ?? new mongoose.Types.ObjectId(), now);
    if (stored) conflicts.push(...findConflicts(value, stored, ASSET_FIELDS, `${resolution} asset`));
    await new Asset(value).validate();
    assets.push({ value, exists: Boolean(stored) });
    for (const row of source.audit.records) observations.push(mapObservation(row, resolution, { datasetId: dataset._id, studyAreaId: area._id, assetId: value._id, importedAt: now }));
  }
  const byKey = new Map();
  for (const record of existing) {
    const key = `${record.resolution}:${record.periodKey}`;
    if (byKey.has(key)) conflicts.push({ record: key, field: 'duplicate_unique_key' });
    byKey.set(key, record);
  }
  const expectedKeys = new Set(observations.map((record) => `${record.resolution}:${record.periodKey}`));
  for (const key of byKey.keys()) if (!expectedKeys.has(key)) conflicts.push({ record: key, field: 'period_not_in_approved_sources' });
  for (const record of observations) {
    await new Observation(record).validate();
    const stored = byKey.get(`${record.resolution}:${record.periodKey}`);
    if (stored) conflicts.push(...findConflicts(record, stored, [...OBSERVATION_FIELDS, 'contentHash'], `${record.resolution}:${record.periodKey}`));
  }
  if (conflicts.length) throw new ModisImportError('Existing records conflict with the approved source; nothing was overwritten.', { conflicts });
  return {
    dataset, area, assets, observations,
    counts: { sourceObservations: 315, newObservations: observations.length - existing.length, existingObservations: existing.length, newAssets: assets.filter((asset) => !asset.exists).length, existingAssets: assets.filter((asset) => asset.exists).length, updates: 0 },
  };
}

async function recheckBytes(sourcePlan) {
  for (const [resolution, source] of Object.entries(sourcePlan.sources)) {
    let bytes;
    try { bytes = await readFile(source.path); } catch { throw new ModisImportError(`Cannot recheck the ${resolution} source before commit.`); }
    if (bytes.length !== APPROVED_SOURCES[resolution].sizeBytes || createHash('sha256').update(bytes).digest('hex') !== APPROVED_SOURCES[resolution].checksum) throw new ModisImportError(`${resolution} source changed after dry-run; transaction cannot commit.`);
  }
}
function summaryAvailability(plan) {
  return {
    status: 'available', aoiKey: AOI_KEY, studyAreaId: plan.area._id,
    ...SPATIAL_PROVENANCE, resolutions: ['16day', 'monthly'], recordCount16day: 207, recordCountMonthly: 108,
    assetIds: plan.assets.map((asset) => asset.value._id), rawProductVerifiedByThisImport: false,
  };
}

export async function commitModisImport(connection, sourcePlan) {
  // Complete a read-only database preflight before any collection/index/document writes.
  const before = await planModisImport(connection, sourcePlan);
  await recheckBytes(sourcePlan);
  const Asset = getDatasetAssetModel(connection), Observation = getVegetationObservationModel(connection), Dataset = getDatasetModel(connection);
  await Observation.createCollection();
  await Observation.createIndexes();
  await Asset.createCollection();
  await Asset.createIndexes();
  const session = await connection.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      // Re-read conflicts inside the transaction. Never parallelize operations on this session.
      const plan = await planModisImport(connection, sourcePlan, { session });
      const assetOps = plan.assets.map(({ value }) => ({ updateOne: {
        filter: { assetKey: value.assetKey, datasetId: value.datasetId, checksum: value.checksum },
        update: { $setOnInsert: value }, upsert: true, timestamps: false,
      } }));
      const assetWrite = await Asset.bulkWrite(assetOps, { session, ordered: true, timestamps: false });
      const observationOps = plan.observations.map((value) => ({ updateOne: {
        filter: { datasetId: value.datasetId, aoiKey: value.aoiKey, resolution: value.resolution, periodKey: value.periodKey, contentHash: value.contentHash },
        update: { $setOnInsert: value }, upsert: true,
      } }));
      const observationWrite = await Observation.bulkWrite(observationOps, { session, ordered: true });
      const verified = await planModisImport(connection, sourcePlan, { session });
      if (verified.counts.existingObservations !== 315 || verified.counts.existingAssets !== 2) throw new ModisImportError('Transactional read-back verification did not find all 315 observations and 2 assets.');
      const availability = summaryAvailability(verified);
      const alreadyUpdated = verified.dataset.validation.status === 'validated' && verified.dataset.processing.status === 'completed'
        && isDeepStrictEqual(canonical(verified.dataset.processedSummaryAvailability), canonical(availability))
        && LIMITATIONS.every((limitation) => verified.dataset.limitations.includes(limitation));
      if (!alreadyUpdated) await Dataset.updateOne({ _id: verified.dataset._id }, {
        $set: {
          'validation.status': 'validated', 'validation.checkedAt': new Date(),
          'validation.description': 'Approved processed AOI CSVs validated and read back from MongoDB; raw NetCDF was not inspected.',
          'validation.evidenceReference': 'reports/modis_ingestion_report.md',
          'processing.status': 'completed', 'processing.checkedAt': new Date(),
          'processing.description': 'Existing processed CSV summaries integrated; no satellite processing, scaling, or QA filters were rerun.',
          'processing.evidenceReference': 'reports/modis_ingestion_report.md', processedSummaryAvailability: availability,
        }, $addToSet: { limitations: { $each: LIMITATIONS } },
      }, { session, runValidators: true }).maxTimeMS(10000);
      await recheckBytes(sourcePlan);
      result = { insertedObservations: observationWrite.upsertedCount, insertedAssets: assetWrite.upsertedCount, existingObservations: plan.counts.existingObservations, existingAssets: plan.counts.existingAssets, lifecycleUpdated: !alreadyUpdated };
    }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 10000 });
  } finally { await session.endSession(); }
  const after = await planModisImport(connection, sourcePlan);
  if (after.counts.existingObservations !== 315 || after.counts.existingAssets !== 2) throw new ModisImportError('Post-commit verification failed; investigate before retrying.');
  return {
    ...result, dryRun: before.counts, storedCounts: { '16day': after.observations.filter((row) => row.resolution === '16day').length, monthly: after.observations.filter((row) => row.resolution === 'monthly').length, total: after.counts.existingObservations, assets: after.counts.existingAssets },
    lifecycle: { acquisition: after.dataset.acquisition.status, validation: after.dataset.validation.status, processing: after.dataset.processing.status },
    assets: after.assets.map(({ value }) => ({ id: value._id, assetKey: value.assetKey, fileName: value.fileName, sizeBytes: value.sizeBytes, checksum: value.checksum, dateStart: value.dateStart, dateEnd: value.dateEnd })),
    indexes: { observations: await Observation.listIndexes(), assets: await Asset.listIndexes() },
  };
}
