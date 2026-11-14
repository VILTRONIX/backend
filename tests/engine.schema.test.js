import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRecordSchema, verifyFieldMappings, validMappedRecord } from '../src/modules/engine/engine.schema.js';

const schema = (field) => ({ type: 'object', additionalProperties: false, required: ['sample'], properties: { sample: field } });

test('restricted schema profile validates nested records, bounds, nulls, arrays, enums, and dates', () => {
  for (const [definition, yes, no] of [
    [{ type: ['number', 'null'], minimum: 0, maximum: 10 }, [0, 10, null], [-1, 11, '1', Infinity]],
    [{ type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 3 }, [1, 2], [0, 3, 1.5]],
    [{ type: 'string', minLength: 1, maxLength: 2 }, ['a', '😀'], ['', 'abc']],
    [{ type: 'string', enum: ['synthetic-a', 'synthetic-b'] }, ['synthetic-a'], ['other']],
    [{ const: 'synthetic' }, ['synthetic'], ['other']],
    [{ type: 'string', format: 'date' }, ['2020-02-29'], ['2021-02-29', '2020-02']],
    [{ type: 'array', items: { type: 'boolean' }, minItems: 1, maxItems: 2 }, [[true], [true, false]], [[], [1], [true, false, true]]],
    [{ type: 'object', properties: { key: { type: 'boolean' } }, additionalProperties: false, required: ['key'] }, [{ key: true }], [{}, { key: true, extra: 1 }]],
  ]) {
    const compiled = compileRecordSchema(schema(definition));
    for (const sample of yes) assert.equal(compiled.validate({ sample }), true);
    for (const sample of no) assert.equal(compiled.validate({ sample }), false);
    assert.equal(compiled.validate({}), false);
    assert.equal(compiled.validate({ sample: yes[0], extra: 1 }), false);
  }
});

test('unsupported or malformed schemas fail closed instead of claiming validation', () => {
  for (const invalid of [null, [], true, {}, { ...schema({ type: 'string' }), additionalProperties: true },
    schema({ $ref: 'external.json' }), schema({ type: 'string', pattern: '[' }), schema({ oneOf: [] }),
    schema({ type: 'unknown' }), schema({ type: [] }), schema({ type: ['number', 'number'] }),
    schema({ type: 'string', format: 'email' }), schema({ minimum: '0' }), schema({ maxLength: -1 }),
    { ...schema({}), required: 'sample' }, { ...schema({}), $schema: 'https://example.invalid/schema' },
    { ...schema({}), properties: JSON.parse('{"__proto__":{"type":"string"}}') },
  ]) assert.throws(() => compileRecordSchema(invalid), (error) => error.status === 'invalid_schema');
});

test('filter mappings must refer to explicitly declared properties with appropriate types', () => {
  const definition = schema({ type: 'string' });
  assert.doesNotThrow(() => verifyFieldMappings({ date: { field: 'sample', granularity: 'month' } }, definition));
  for (const mappings of [{ year: 'sample' }, { mapUnit: 'absent' }]) {
    assert.throws(() => verifyFieldMappings(mappings, definition), (error) => error.status === 'invalid_schema');
  }
  assert.equal(validMappedRecord({ sample: '2020-02' }, { date: { field: 'sample', granularity: 'month' } }), true);
  assert.equal(validMappedRecord({ sample: '2020-13' }, { date: { field: 'sample', granularity: 'month' } }), false);
});
