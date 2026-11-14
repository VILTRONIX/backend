import { ENGINE_DATASETS, METADATA_REQUIREMENTS } from './engine.registry.js';
import { fail, isRecord, validateReference } from './engine.files.js';
import { safeField } from './engine.schema.js';

// Provisional backend adapter profile, NOT the unreceived Data Engineering contract.
export const MANIFEST_PROFILE = 'terrapulse.features/1';
const identifier = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
export function publicText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096
    || /[\x00-\x1f]|[a-zA-Z]:[\\/]|\\\\|(?:mongodb(?:\+srv)?|file):/i.test(value) || value.startsWith('/')) return false;
  for (const match of value.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi)) {
    try { const url = new URL(match[0]); if (url.protocol !== 'https:' || url.username || url.password) return false; }
    catch { return false; }
  }
  if (/(?:^|\s)\/[^\s]+/.test(value.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, '[URL]'))) return false;
  return true;
}

export function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.contractVersion !== MANIFEST_PROFILE || !Array.isArray(manifest.datasets)
    || manifest.datasets.length > ENGINE_DATASETS.length) fail('validation_failed', 'unsupported_manifest_contract');
  const logicalIds = new Set(), engineIds = new Set();
  for (const entry of manifest.datasets) {
    if (!isRecord(entry) || !ENGINE_DATASETS.some(({ id }) => id === entry.logicalId) || !identifier(entry.id)
      || logicalIds.has(entry.logicalId) || engineIds.has(entry.id)) fail('validation_failed', 'invalid_manifest_references');
    logicalIds.add(entry.logicalId); engineIds.add(entry.id);
  }
  return manifest;
}

export function validateDescriptor(entry) {
  if (!Array.isArray(entry.files) || !entry.files.length || entry.files.length > 32) fail('validation_failed', 'invalid_file_references');
  const ids = new Set(), paths = new Set();
  for (const file of entry.files) {
    if (!isRecord(file) || !identifier(file.id) || typeof file.format !== 'string'
      || !file.format.length || file.format.length > 40 || ids.has(file.id) || paths.has(file.path)) fail('validation_failed', 'invalid_file_references');
    validateReference(file.path);
    // Missing schema references have a distinct, honest status.
    if (file.schema === undefined) fail('schema_missing', 'schema_reference_missing');
    validateReference(file.schema);
    ids.add(file.id); paths.add(file.path);
  }
  const metadata = entry.metadata;
  if (!isRecord(metadata) || METADATA_REQUIREMENTS.some((field) => !Object.hasOwn(metadata, field))
    || !publicText(metadata.source) || !publicText(metadata.spatialScope)
    || !isRecord(metadata.observationPeriod) || !['start', 'end'].every((key) => Object.hasOwn(metadata.observationPeriod, key)
      && (metadata.observationPeriod[key] === null || publicText(metadata.observationPeriod[key])))
    || !Array.isArray(metadata.provenance) || !metadata.provenance.length || metadata.provenance.length > 100 || !metadata.provenance.every(publicText)
    || !Array.isArray(metadata.limitations) || metadata.limitations.length > 100 || !metadata.limitations.every(publicText)) {
    fail('validation_failed', 'required_metadata_missing_or_invalid');
  }
  const mappings = entry.fieldMappings;
  if (!isRecord(mappings) || Object.keys(mappings).some((key) => !['date', 'year', 'mapUnit'].includes(key))) fail('validation_failed', 'invalid_field_mappings');
  for (const [role, value] of Object.entries(mappings)) {
    if (role === 'date' ? !isRecord(value) || !safeField(value.field) || !['month', 'day'].includes(value.granularity)
      : !safeField(value)) fail('validation_failed', 'invalid_field_mappings');
  }
  // Whitelist metadata explicitly: no source file references or private extra metadata are published.
  return {
    ...entry,
    fieldMappings: Object.fromEntries(Object.entries(mappings).map(([role, mapping]) => [role,
      role === 'date' ? { field: mapping.field, granularity: mapping.granularity } : mapping])),
    metadata: {
      source: metadata.source,
      observationPeriod: { start: metadata.observationPeriod.start, end: metadata.observationPeriod.end },
      spatialScope: metadata.spatialScope, provenance: [...metadata.provenance], limitations: [...metadata.limitations],
    },
  };
}
