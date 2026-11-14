import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv } from '../src/utils/csv.js';
import { decodeCsvValue, validateCsvSchema } from '../src/modules/engine/engine.csv.js';
import { compileRecordSchema } from '../src/modules/engine/engine.schema.js';

const csv = { null_tokens: ['', 'NULL'], boolean_tokens: { True: true, False: false } };
test('schema-directed decoding rejects ambiguous/coerced values and preserves strings', () => {
  assert.equal(decodeCsvValue('False', { type: 'boolean' }, csv), false);
  assert.equal(decodeCsvValue('001', { type: 'string' }, csv), '001');
  assert.equal(decodeCsvValue('2020-01', { type: 'string' }, csv), '2020-01');
  for (const token of ['', 'NULL']) assert.equal(decodeCsvValue(token, { type: ['number', 'null'] }, csv), null);
  for (const [raw, type] of [['false', 'boolean'], ['1', 'boolean'], ['', 'number'], ['NULL', 'string'], ['NaN', 'number'], ['Infinity', 'number'],
    [' 1', 'number'], ['1e999', 'number'], ['1.0', 'integer'], ['9007199254740992', 'integer'], ['9007199254740992', 'number']]) {
    assert.throws(() => decodeCsvValue(raw, { type }, csv), (error) => error.status === 'validation_failed');
  }
});

test('tokenizer handles quoted commas, escaped quotes, embedded newlines, UTF-8, BOM and empty cells', () => {
  assert.deepEqual(parseCsv('\ufeffkey,text,empty\r\n001,"Synthetic ""quote"", café\nline",\r\n'), {
    headers: ['key', 'text', 'empty'], rows: [['001', 'Synthetic "quote", café\nline', '']],
  });
  for (const text of ['a,a\n1,2\n', 'a,b\n1\n', 'a\n"unterminated', 'a\n"closed"extra']) assert.throws(() => parseCsv(text));
  assert.throws(() => parseCsv('a\n12345\n', { maxFieldBytes: 2 }));
  assert.throws(() => parseCsv('a\n1\n2\n', { maxRecords: 1 }));
});

test('schema extensions are retained, patterns enforced, and JSON histogram fields stay strings', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['key', 'histogram'], 'x-future-metadata': { note: 'synthetic' },
    properties: { key: { type: 'string', pattern: '^\\d+$', 'x-unit': null }, histogram: { type: 'string', 'x-content': 'json-count-object' } } };
  const compiled = compileRecordSchema(schema);
  assert.deepEqual(compiled.schema['x-future-metadata'], schema['x-future-metadata']);
  assert.equal(compiled.validate({ key: '001', histogram: '{"0":2}' }), true);
  for (const histogram of ['{', '[]', '{"16":1}', '{"0":1.5}', '{"0":-1}', '{"0":9007199254740992}']) assert.equal(compiled.validate({ key: '001', histogram }), false);
  assert.equal(compiled.validate({ key: 'abc', histogram: '{}' }), false);
  assert.equal(compiled.validate({ key: '001', histogram: {} }), false);
  assert.throws(() => validateCsvSchema(schema), (error) => error.status === 'invalid_schema');
});
