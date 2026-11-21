import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv, sql } from '../src/2026-11-21-csv.js';

test('parseCsv handles quotes, commas, embedded newlines and CRLF', () => {
  const rows = parseCsv('a,b\r\n1,"x, ""y""\nz"\r\n2,\r\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"\nz' }, { a: '2', b: '' }]);
});

test('toCsv round-trips through parseCsv', () => {
  const rows = [{ a: 'plain', b: 'with, comma' }, { a: 'quote "q"', b: 'line\nbreak' }];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});

test('sql quotes strings and passes numbers and nulls', () => {
  assert.equal(sql("it's"), "'it''s'");
  assert.equal(sql(3.5), '3.5');
  assert.equal(sql(''), 'NULL');
  assert.equal(sql(null), 'NULL');
});
