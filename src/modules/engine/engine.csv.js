import { isDeepStrictEqual } from 'node:util';
import { parseCsv } from '../../utils/csv.js';
import { fail, isRecord, checksum } from './engine.files.js';

export const NUMBER_TOKEN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export const schemaTypes = (property) => Array.isArray(property.type) ? property.type : [property.type];

export function validateCsvSchema(schema) {
  const csv = schema['x-csv'];
  if (!isRecord(csv) || csv.encoding !== 'utf-8' || csv.delimiter !== ',' || csv.decode_before_json_schema_validation !== true
    || !Array.isArray(csv.ordered_columns) || !csv.ordered_columns.length
    || new Set(csv.ordered_columns).size !== csv.ordered_columns.length
    || !isDeepStrictEqual([...csv.ordered_columns].sort(), Object.keys(schema.properties).sort())
    || !isDeepStrictEqual(csv.null_tokens, ['', 'NULL'])
    || !isDeepStrictEqual(csv.boolean_tokens, { True: true, False: false })) fail('invalid_schema', 'invalid_csv_declarations');
  for (const key of csv.ordered_columns) {
    const types = schemaTypes(schema.properties[key]).filter((type) => type !== 'null');
    if (types.length !== 1 || !['string', 'integer', 'number', 'boolean'].includes(types[0])) fail('invalid_schema', 'unsupported_csv_type');
  }
  return csv;
}

export function decodeCsvValue(raw, property, csv) {
  const types = schemaTypes(property);
  if (csv.null_tokens.includes(raw)) {
    if (!types.includes('null')) fail('validation_failed', 'nonnullable_csv_null');
    return null;
  }
  if (types.includes('string')) return raw;
  if (types.includes('boolean')) {
    if (!Object.hasOwn(csv.boolean_tokens, raw)) fail('validation_failed', 'invalid_csv_boolean');
    return csv.boolean_tokens[raw];
  }
  if (!NUMBER_TOKEN.test(raw) || types.includes('integer') && !/^[+-]?\d+$/.test(raw)) fail('validation_failed', 'invalid_csv_number');
  const value = Number(raw);
  if (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value)) fail('validation_failed', 'invalid_csv_number');
  return value;
}

export async function readBoundedBytes(source, maxBytes, reason) {
  if (source.size > maxBytes) fail('validation_failed', reason);
  const chunks = []; let size = 0;
  for await (const chunk of source.handle.createReadStream({ autoClose: false, highWaterMark: 65536 })) {
    size += chunk.length;
    if (size > maxBytes) fail('validation_failed', reason);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function scanCsv(source, onRecord, limits, { schema } = {}) {
  if (!schema) fail('invalid_schema', 'csv_schema_required');
  const csv = validateCsvSchema(schema);
  const bytes = await readBoundedBytes(source, limits.csvBytes, 'csv_size_limit');
  let table;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    table = parseCsv(text, { maxRecords: limits.records, maxColumns: 1000, maxFieldBytes: limits.recordBytes });
  } catch { fail('validation_failed', 'invalid_csv_structure_or_encoding'); }
  if (!isDeepStrictEqual(table.headers, csv.ordered_columns)) fail('validation_failed', 'csv_header_mismatch');
  for (const row of table.rows) {
    if (row.reduce((sum, cell) => sum + Buffer.byteLength(cell), 0) > limits.recordBytes) fail('validation_failed', 'record_size_limit');
    const record = Object.fromEntries(table.headers.map((key, index) => [key, decodeCsvValue(row[index], schema.properties[key], csv)]));
    onRecord(record);
  }
  return { checksum: checksum(bytes) };
}
