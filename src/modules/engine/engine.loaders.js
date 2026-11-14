import { createHash } from 'node:crypto';
import { checksum, fail, isRecord } from './engine.files.js';
import { scanCsv } from './engine.csv.js';

export const DEFAULT_LIMITS = Object.freeze({
  manifestBytes: 1024 * 1024, schemaBytes: 256 * 1024,
  jsonBytes: 8 * 1024 * 1024, csvBytes: 8 * 1024 * 1024, datasetBytes: 256 * 1024 * 1024,
  recordBytes: 1024 * 1024, records: 1000000,
});
const parse = (bytes) => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('validation_failed', 'invalid_data_encoding_or_json'); }
};

async function scanJson(source, onRecord, limits) {
  if (source.size > limits.jsonBytes) fail('validation_failed', 'json_size_limit');
  const chunks = []; let size = 0;
  for await (const chunk of source.handle.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
    size += chunk.length;
    if (size > limits.jsonBytes) fail('validation_failed', 'json_size_limit');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks), records = parse(bytes);
  if (!Array.isArray(records)) fail('validation_failed', 'json_array_required');
  for (const record of records) {
    if (Buffer.byteLength(JSON.stringify(record)) > limits.recordBytes) fail('validation_failed', 'record_size_limit');
    onRecord(record);
  }
  return { checksum: checksum(bytes) };
}

async function scanNdjson(source, onRecord, limits) {
  const hash = createHash('sha256'); let pending = Buffer.alloc(0), size = 0;
  const line = (bytes) => {
    if (bytes.length > limits.recordBytes) fail('validation_failed', 'record_size_limit');
    if (bytes.toString('utf8').trim()) onRecord(parse(bytes));
  };
  for await (const chunk of source.handle.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
    size += chunk.length;
    if (size > limits.datasetBytes) fail('validation_failed', 'dataset_size_limit');
    hash.update(chunk); pending = Buffer.concat([pending, chunk]);
    let index;
    while ((index = pending.indexOf(10)) !== -1) { line(pending.subarray(0, index)); pending = pending.subarray(index + 1); }
    if (pending.length > limits.recordBytes) fail('validation_failed', 'record_size_limit');
  }
  if (pending.length) line(pending);
  return { checksum: hash.digest('hex') };
}

// Additional adapters must implement this scan interface and retain read-only, bounded behavior.
export const FORMAT_ADAPTERS = Object.freeze({ json: scanJson, ndjson: scanNdjson, csv: scanCsv });

export function validJsonRecord(record) {
  let nodes = 0;
  function visit(value, depth = 0) {
    if (++nodes > 100000 || depth > 24) return false;
    if (typeof value === 'number') return Number.isFinite(value);
    if (value && typeof value === 'object') return Object.values(value).every((item) => visit(item, depth + 1));
    return true;
  }
  return isRecord(record) && visit(record);
}
