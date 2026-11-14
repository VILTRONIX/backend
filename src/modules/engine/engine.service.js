import { AppError } from '../../utils/appError.js';
import { serialize, deserialize } from 'node:v8';
import { stat } from 'node:fs/promises';
import { resolveEnginePaths } from '../../config/features.js';
import { ENGINE_DATASETS, METADATA_REQUIREMENTS } from './engine.registry.js';
import { MANIFEST_PROFILE, validateManifest, validateDescriptor } from './engine.manifest.js';
import { EngineIssue, fail, openSource, readDocument } from './engine.files.js';
import { compileRecordSchema, verifyFieldMappings, validMappedRecord } from './engine.schema.js';
import { DEFAULT_LIMITS, FORMAT_ADAPTERS, validJsonRecord } from './engine.loaders.js';
import { parseEngineQuery, createRecordFilter } from './engine.query.js';
import { adaptContractV1, verifyFinalSchema } from './engine.contract-v1.js';
import { createFinalIntegrity } from './engine.integrity.js';
import { parseFinalQuery, createFinalFilter, FINAL_FILTERS } from './engine.contract-query.js';
import { createSnapshotCache } from './engine.snapshot-cache.js';
import { DAILY_ID, parseDailyQuery, loadPowerDaily } from './engine.power-daily.js';

const issueOf = (error) => error instanceof EngineIssue ? error : new EngineIssue('validation_failed', 'source_unreadable');
function definitionFor(id) {
  const definition = ENGINE_DATASETS.find((entry) => entry.id === id);
  if (!definition) throw new AppError(404, 'ENGINE_DATASET_NOT_FOUND', 'Engine dataset was not found.');
  return definition;
}
const initial = (definition) => ({
  id: definition.id, expectedProvider: definition.provider, expectedSource: definition.source,
  purpose: definition.purpose, optional: definition.optional, expectedMetadataRequirements: [...METADATA_REQUIREMENTS],
  status: 'missing_manifest', reason: 'missing_manifest', structurallyReady: false,
  verification: { file: 'pending', schema: 'pending', records: 'pending', scientific: 'not_assessed' },
  metadata: null, fieldMappings: null, provenance: null,
});

// Build outside inspect() so a cached guard cannot retain its parsed record array.
function fingerprintVerifier(guards, discovery, isCurrent) {
  return async () => {
    await Promise.all(guards.map((verify) => verify()));
    if (!isCurrent(discovery)) fail('validation_failed', 'source_changed');
  };
}

export function createEngineService({ engineRoot, featuresRoot, schemasRoot, manifestAdapter = (raw) => raw, adapters = FORMAT_ADAPTERS, limits: overrides = {}, cache: cacheOptions = {} } = {}) {
  const environment = Object.fromEntries([['TERRAPULSE_ENGINE_ROOT', engineRoot], ['TERRAPULSE_FEATURES_ROOT', featuresRoot],
    ['TERRAPULSE_SCHEMAS_ROOT', schemasRoot]].filter(([, value]) => value !== undefined && value !== null));
  const paths = resolveEnginePaths(environment), root = paths.featuresRoot;
  const defaults = resolveEnginePaths();
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const snapshots = createSnapshotCache(cacheOptions), cacheEnabled = snapshots.limits.enabled;
  const counters = { manifestReads: 0, schemaValidations: 0, recordValidations: 0, datasetValidations: 0 };
  let manifestSnapshot, manifestFlight;
  const dailyToken = {};
  const isCurrentManifest = (discovery) => manifestSnapshot === discovery;
  for (const [key, value] of Object.entries(limits)) {
    if (!Object.hasOwn(DEFAULT_LIMITS, key) || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid Engine loader limits.');
  }

  async function readManifest() {
    try {
      counters.manifestReads += 1;
      const document = await readDocument(root, 'feature_manifest.json', {
        maxBytes: limits.manifestBytes, missingStatus: 'missing_manifest', invalidStatus: 'validation_failed',
      });
      const adapted = await manifestAdapter(document.value);
      const manifest = adapted?.contract_version !== undefined ? adaptContractV1(adapted) : adapted;
      return { manifest: validateManifest(manifest), checksum: document.checksum, verifyUnchanged: document.verifyUnchanged };
    } catch (error) { return { issue: issueOf(error) }; }
  }

  async function discover() {
    if (!cacheEnabled) return readManifest();
    if (manifestFlight) return manifestFlight;
    const pending = (async () => {
      if (manifestSnapshot) {
        try { await manifestSnapshot.verifyUnchanged(); return manifestSnapshot; }
        catch { manifestSnapshot = undefined; snapshots.clear(); }
      }
      const candidate = await readManifest();
      if (!candidate.issue) manifestSnapshot = candidate;
      return candidate;
    })();
    manifestFlight = pending;
    try { return await pending; } finally { if (manifestFlight === pending) manifestFlight = undefined; }
  }

  async function inspect(definition, discovery, query, capture = false) {
    const dataset = initial(definition), items = []; let total = 0, stage = null;
    let records = capture ? [] : null, capturedBytes = 0, verifySnapshot;
    try {
      if (discovery.issue) throw discovery.issue;
      const raw = discovery.manifest.datasets.find((entry) => entry.logicalId === definition.id);
      if (!raw) fail('missing_file', 'dataset_not_declared');
      const descriptor = validateDescriptor(raw);
      dataset.engineDatasetId = descriptor.id;
      dataset.metadata = descriptor.metadata;
      dataset.fieldMappings = structuredClone(descriptor.fieldMappings);
      const final = descriptor.finalContract;
      const matches = query ? (final ? createFinalFilter(definition.id, query) : createRecordFilter(query, descriptor.fieldMappings)) : () => false;
      const prepared = [], verifySources = [discovery.verifyUnchanged];
      const fingerprints = new Map([['manifest', discovery.verifyUnchanged]]);
      let datasetBytes = 0;
      for (const file of descriptor.files) {
        stage = 'file';
        if (!Object.hasOwn(adapters, file.format) || typeof adapters[file.format] !== 'function') fail('unsupported_format', 'format_adapter_unavailable');
        const source = await openSource(root, file.path);
        try {
          datasetBytes += source.size;
          if (datasetBytes > limits.datasetBytes) fail('validation_failed', 'dataset_size_limit');
          verifySources.push(source.verifyPathUnchanged);
        } finally { await source.close(); }
        stage = 'schema';
        const schemaDocument = await readDocument(final ? paths.schemasRoot : root, file.schema, {
          maxBytes: limits.schemaBytes, missingStatus: 'schema_missing', invalidStatus: 'invalid_schema',
        });
        if (final && schemaDocument.checksum !== file.expectedSchemaChecksum) fail('invalid_schema', 'schema_checksum_mismatch');
        const compiled = compileRecordSchema(schemaDocument.value);
        counters.schemaValidations += 1;
        verifyFieldMappings(descriptor.fieldMappings, compiled.schema);
        if (final) {
          dataset.metadata = { ...dataset.metadata, ...verifyFinalSchema(descriptor, compiled.schema), supportedFilters: [...FINAL_FILTERS[definition.id]] };
        }
        verifySources.push(schemaDocument.verifyUnchanged);
        fingerprints.set(`schema:${file.schema}`, schemaDocument.verifyUnchanged);
        prepared.push({ file, compiled, schemaChecksum: schemaDocument.checksum });
      }
      dataset.verification.file = 'verified';
      dataset.verification.schema = 'verified';
      stage = 'records';
      const files = [];
      let recordCount = 0;
      const integrity = final ? createFinalIntegrity(descriptor, prepared[0].compiled.schema) : null;
      for (const { file, compiled, schemaChecksum } of prepared) {
        const source = await openSource(root, file.path);
        let count = 0;
        try {
          if (source.size > limits.datasetBytes) fail('validation_failed', 'dataset_size_limit');
          const result = await adapters[file.format](source, (record) => {
            if (++recordCount > limits.records) fail('validation_failed', 'record_count_limit');
            if (!validJsonRecord(record) || !compiled.validate(record) || !validMappedRecord(record, descriptor.fieldMappings)) fail('validation_failed', 'invalid_record');
            integrity?.accept(record);
            counters.recordValidations += 1;
            count += 1;
            if (records) {
              capturedBytes += Buffer.byteLength(JSON.stringify(record));
              if (capturedBytes > snapshots.limits.maxBytes || records.length >= snapshots.limits.maxRecords) records = null;
              else records.push(record);
            }
            if (matches(record)) {
              total += 1;
              if (total > (query.page - 1) * query.limit && items.length < query.limit) items.push(record);
            }
          }, limits, { schema: compiled.schema });
          await source.verifyUnchanged();
          verifySources.push(source.verifyPathUnchanged);
          fingerprints.set(`file:${file.path}`, source.verifyPathUnchanged);
          if (!count) fail('validation_failed', 'empty_dataset');
          if (final && result.checksum !== file.expectedChecksum) fail('validation_failed', 'output_checksum_mismatch');
          files.push({ id: file.id, format: file.format, checksum: result.checksum, schemaChecksum, recordCount: count });
        } finally { await source.close(); }
      }
      integrity?.finish();
      for (const verify of verifySources) await verify();
      counters.datasetValidations += 1;
      dataset.status = 'available'; dataset.reason = null; dataset.structurallyReady = true;
      dataset.verification.records = 'verified';
      dataset.recordCount = recordCount;
      dataset.provenance = { manifestChecksum: discovery.checksum, checksumAlgorithm: 'sha256', files,
        ...(final ? { contractVersion: '1.0.0', originalSourceVerification: 'not_independently_verified' } : {}) };
      verifySnapshot = fingerprintVerifier([...fingerprints.values()], discovery, isCurrentManifest);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const issue = issueOf(error);
      dataset.status = issue.status; dataset.reason = issue.reason;
      const failedStage = ['schema_missing', 'invalid_schema'].includes(issue.status) ? 'schema'
        : issue.status === 'missing_file' && issue.reason !== 'dataset_not_declared' || issue.reason === 'unsafe_reference' ? 'file' : stage;
      if (failedStage) dataset.verification[failedStage] = 'failed';
    }
    return { dataset, items: dataset.structurallyReady ? items : [], pagination: query ? { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } : undefined,
      ...(capture && dataset.structurallyReady ? { records, verify: verifySnapshot } : {}) };
  }

  async function snapshot(definition, discovery) {
    try {
      return await snapshots.get(definition.id, discovery, async () => {
        const result = await inspect(definition, discovery, undefined, true);
        if (!result.dataset.structurallyReady) return { dataset: result.dataset };
        if (!result.records) return { dataset: result.dataset, verify: result.verify };
        const metadata = serialize(result.dataset), records = serialize(result.records);
        return { metadata, records, byteSize: metadata.byteLength + records.byteLength,
          recordCount: result.dataset.recordCount, verify: result.verify };
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      const dataset = initial(definition), issue = issueOf(error);
      dataset.status = issue.status; dataset.reason = issue.reason; dataset.verification.records = 'failed';
      return { dataset };
    }
  }
  const datasetOf = (value) => value.metadata ? deserialize(value.metadata) : structuredClone(value.dataset);
  async function datasetFor(definition, discovery) {
    return cacheEnabled ? datasetOf(await snapshot(definition, discovery)) : (await inspect(definition, discovery)).dataset;
  }

  const service = {
    async readDaily(query = {}) {
      const parsed = parseDailyQuery(query);
      try {
        const value = cacheEnabled ? await snapshots.get(DAILY_ID, dailyToken, () => loadPowerDaily(paths, limits)) : await loadPowerDaily(paths, limits);
        const dataset = deserialize(value.metadata), items = []; let total = 0;
        for (const record of deserialize(value.records)) {
          if (parsed.startDate && record.date < parsed.startDate || parsed.endDate && record.date > parsed.endDate) continue;
          total += 1;
          if (total > (parsed.page - 1) * parsed.limit && items.length < parsed.limit) items.push(record);
        }
        return { dataset, items, pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) } };
      } catch (error) {
        if (error instanceof AppError) throw error;
        const issue = issueOf(error);
        throw new AppError(503, 'ENGINE_DATASET_UNAVAILABLE', 'Optional daily POWER dataset is unavailable.', {
          datasetId: DAILY_ID, optional: true, status: issue.status, reason: issue.reason,
        });
      }
    },
    async listDatasets() {
      const discovery = await discover();
      const items = [];
      for (const definition of ENGINE_DATASETS) items.push(await datasetFor(definition, discovery));
      return {
        manifest: { status: discovery.issue?.status ?? 'available', reason: discovery.issue?.reason ?? null,
          adapterProfile: MANIFEST_PROFILE, finalContractAgreement: discovery.manifest?.sourceContractVersion === '1.0.0' ? 'supported' : 'pending',
          ...(discovery.manifest?.sourceContractVersion ? { sourceContractVersion: discovery.manifest.sourceContractVersion } : {}) },
        items,
      };
    },
    async getDataset(id) { return datasetFor(definitionFor(id), await discover()); },
    async readDataset(id, query = {}) {
      const definition = definitionFor(id), discovery = await discover();
      const parsed = discovery.manifest?.sourceContractVersion === '1.0.0' ? parseFinalQuery(id, query) : parseEngineQuery(query);
      let result;
      if (!cacheEnabled) result = await inspect(definition, discovery, parsed);
      else {
        const value = await snapshot(definition, discovery), dataset = datasetOf(value);
        if (dataset.structurallyReady && value.records) {
          const matches = dataset.metadata.contractVersion === '1.0.0' ? createFinalFilter(id, parsed) : createRecordFilter(parsed, dataset.fieldMappings);
          const items = []; let total = 0;
          for (const record of deserialize(value.records)) if (matches(record)) {
            total += 1;
            if (total > (parsed.page - 1) * parsed.limit && items.length < parsed.limit) items.push(record);
          }
          result = { dataset, items, pagination: { page: parsed.page, limit: parsed.limit, total, totalPages: Math.ceil(total / parsed.limit) } };
        } else if (dataset.structurallyReady) result = await inspect(definition, discovery, parsed);
        else result = { dataset };
      }
      if (!result.dataset.structurallyReady) throw new AppError(503, 'ENGINE_DATASET_UNAVAILABLE', 'Engine dataset is unavailable.', {
        datasetId: id, status: result.dataset.status, reason: result.dataset.reason,
        optional: definition.optional, verification: result.dataset.verification,
      });
      return result;
    },
    getCacheStats: () => ({ ...snapshots.stats(), ...counters }),
    async getHealth() {
      const directoryAvailable = async (root) => { try { return (await stat(root)).isDirectory(); } catch { return false; } };
      const [catalog, featureDirectoryAvailable, schemaDirectoryAvailable] = await Promise.all([
        service.listDatasets(), directoryAvailable(paths.featuresRoot), directoryAvailable(paths.schemasRoot),
      ]);
      const summarize = (dataset) => ({ id: dataset.id, optional: dataset.optional, ready: dataset.structurallyReady,
        status: dataset.status, reason: dataset.reason, recordCount: dataset.recordCount ?? null,
        fileIntegrityStatus: dataset.structurallyReady ? 'verified' : dataset.verification.file === 'failed' || dataset.verification.records === 'failed' ? 'failed' : 'not_verified',
        schemaStatus: dataset.verification.schema, scientificVerification: 'not_assessed' });
      const mandatoryDatasets = catalog.items.filter((dataset) => !dataset.optional).map(summarize);
      const optionalDatasets = catalog.items.filter((dataset) => dataset.optional).map(summarize);
      const contractVersion = catalog.manifest.sourceContractVersion ?? null;
      const ready = featureDirectoryAvailable && schemaDirectoryAvailable && contractVersion === '1.0.0' && mandatoryDatasets.every((dataset) => dataset.ready);
      return { status: ready ? 'ready' : 'not_ready', ready,
        configuration: { status: featureDirectoryAvailable && schemaDirectoryAvailable ? 'available' : 'unavailable',
          source: engineRoot ? 'engine_root' : paths.featuresRoot === defaults.featuresRoot && paths.schemasRoot === defaults.schemasRoot ? 'backend_defaults' : 'independent_roots',
          featureDirectoryAvailable, schemaDirectoryAvailable },
        manifest: { status: catalog.manifest.status, reason: catalog.manifest.reason, contractVersion }, contractVersion,
        mandatoryDatasets, optionalDatasets,
        fileIntegrityStatus: mandatoryDatasets.every((dataset) => dataset.fileIntegrityStatus === 'verified') ? 'verified' : 'not_verified',
        schemaStatus: mandatoryDatasets.every((dataset) => dataset.schemaStatus === 'verified') ? 'verified' : 'not_verified',
        scientificVerification: 'not_assessed' };
    },
  };
  return service;
}
