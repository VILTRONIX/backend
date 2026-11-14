import { isDeepStrictEqual } from 'node:util';
import { isCoverageDate } from '../datasets/dataset.validation.js';
import { fail, isRecord } from './engine.files.js';

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'];
const KEYWORDS = ['$schema', '$id', '$comment', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format', 'pattern'];
export const safeField = (value) => typeof value === 'string' && value.length > 0 && value.length <= 120
  && !['__proto__', 'prototype', 'constructor'].includes(value);
export const validDate = (value, granularity) => typeof value === 'string'
  && (granularity === 'month' ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/).test(value) && isCoverageDate(value);
const typeOf = (value, type) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
  : type === 'object' ? isRecord(value) : type === 'integer' ? Number.isSafeInteger(value)
    : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
const typesOf = (schema) => Array.isArray(schema.type) ? schema.type : [schema.type];

// Explicit restricted profile. Unsupported assertions are rejected, never silently ignored.
export function compileRecordSchema(schema) {
  let nodes = 0; const patterns = new WeakMap();
  function inspect(node, depth = 0) {
    if (++nodes > 2000 || depth > 24) fail('invalid_schema', 'schema_complexity_limit');
    if (typeof node === 'boolean') return;
    if (!isRecord(node) || Object.keys(node).some((key) => !KEYWORDS.includes(key) && !key.startsWith('x-'))) fail('invalid_schema', 'unsupported_schema');
    if (node.pattern !== undefined) {
      if (typeof node.pattern !== 'string' || node.pattern.length > 512) fail('invalid_schema', 'invalid_schema_pattern');
      try { patterns.set(node, new RegExp(node.pattern, 'u')); } catch { fail('invalid_schema', 'invalid_schema_pattern'); }
    }
    if (node.$schema !== undefined && node.$schema !== 'https://json-schema.org/draft/2020-12/schema') fail('invalid_schema', 'unsupported_schema_dialect');
    for (const key of ['$id', '$comment', 'title', 'description']) if (node[key] !== undefined && typeof node[key] !== 'string') fail('invalid_schema', 'invalid_schema_keyword');
    if (node.type !== undefined && (!typesOf(node).length || new Set(typesOf(node)).size !== typesOf(node).length || typesOf(node).some((type) => !TYPES.includes(type)))) fail('invalid_schema', 'invalid_schema_type');
    if (node.properties !== undefined) {
      if (!isRecord(node.properties) || !Object.keys(node.properties).every(safeField)) fail('invalid_schema', 'invalid_schema_properties');
      for (const value of Object.values(node.properties)) inspect(value, depth + 1);
    }
    if (node.required !== undefined && (!Array.isArray(node.required) || !node.required.every(safeField)
      || new Set(node.required).size !== node.required.length)) fail('invalid_schema', 'invalid_schema_required');
    if (node.additionalProperties !== undefined) inspect(node.additionalProperties, depth + 1);
    if (node.items !== undefined) inspect(node.items, depth + 1);
    if (node.enum !== undefined && (!Array.isArray(node.enum) || !node.enum.length)) fail('invalid_schema', 'invalid_schema_enum');
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (node[key] !== undefined && (typeof node[key] !== 'number' || !Number.isFinite(node[key]))) fail('invalid_schema', 'invalid_schema_bound');
    }
    for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (node[key] !== undefined && (!Number.isSafeInteger(node[key]) || node[key] < 0)) fail('invalid_schema', 'invalid_schema_bound');
    }
    if (node.format !== undefined && node.format !== 'date') fail('invalid_schema', 'unsupported_schema_format');
  }
  inspect(schema);
  if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties) || schema.additionalProperties !== false) {
    fail('invalid_schema', 'closed_record_schema_required');
  }
  function valid(value, node, depth = 0) {
    if (depth > 24) return false;
    if (typeof node === 'boolean') return node;
    if (node.type !== undefined && !typesOf(node).some((type) => typeOf(value, type))) return false;
    if (node.enum && !node.enum.some((candidate) => isDeepStrictEqual(value, candidate))) return false;
    if (Object.hasOwn(node, 'const') && !isDeepStrictEqual(value, node.const)) return false;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return false;
      if (node.minimum !== undefined && value < node.minimum || node.maximum !== undefined && value > node.maximum
        || node.exclusiveMinimum !== undefined && value <= node.exclusiveMinimum || node.exclusiveMaximum !== undefined && value >= node.exclusiveMaximum) return false;
    }
    if (typeof value === 'string') {
      const length = [...value].length;
      if (node.minLength !== undefined && length < node.minLength || node.maxLength !== undefined && length > node.maxLength
        || node.format === 'date' && !validDate(value, 'day') || patterns.has(node) && !patterns.get(node).test(value)) return false;
      if (node['x-content'] === 'json-count-object' && !validCountObject(value)) return false;
    }
    if (Array.isArray(value)) {
      if (node.minItems !== undefined && value.length < node.minItems || node.maxItems !== undefined && value.length > node.maxItems) return false;
      if (node.items !== undefined && !value.every((item) => valid(item, node.items, depth + 1))) return false;
    } else if (isRecord(value)) {
      if ((node.required ?? []).some((key) => !Object.hasOwn(value, key))) return false;
      for (const [key, item] of Object.entries(value)) {
        const child = Object.hasOwn(node.properties ?? {}, key) ? node.properties[key] : node.additionalProperties;
        if (child !== undefined && !valid(item, child, depth + 1)) return false;
      }
    }
    return true;
  }
  return { schema, validate: (record) => valid(record, schema) };
}

export function validCountObject(value) {
  try {
    const object = JSON.parse(value);
    return isRecord(object) && Object.entries(object).every(([key, count]) => /^\d+$/.test(key)
      && Number(key) <= 15 && Number.isSafeInteger(count) && count >= 0);
  } catch { return false; }
}

export function verifyFieldMappings(mappings, schema) {
  for (const [role, mapping] of Object.entries(mappings)) {
    const field = role === 'date' ? mapping.field : mapping;
    const declaration = schema.properties[field];
    if (!Object.hasOwn(schema.properties, field) || !isRecord(declaration)) fail('invalid_schema', 'mapping_not_declared_in_schema');
    const expected = role === 'year' ? ['integer'] : role === 'mapUnit' ? ['string', 'integer'] : ['string'];
    if (!typesOf(declaration).some((type) => expected.includes(type))) fail('invalid_schema', 'mapping_type_mismatch');
  }
}

export function validMappedRecord(record, mappings) {
  if (mappings.date && !validDate(record[mappings.date.field], mappings.date.granularity)) return false;
  if (mappings.year && (!Number.isInteger(record[mappings.year]) || record[mappings.year] < 1 || record[mappings.year] > 9999)) return false;
  if (mappings.mapUnit && !(typeof record[mappings.mapUnit] === 'string' && record[mappings.mapUnit].length > 0 || Number.isSafeInteger(record[mappings.mapUnit]))) return false;
  return true;
}
