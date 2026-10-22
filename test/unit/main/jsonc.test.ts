import { describe, it, expect } from 'vitest';
import { duplicateKeys, readJsonc } from '../../../src/main/jsonc';

describe('reading the config folder’s format', () => {
  it('reads plain JSON as JSON.parse does', () => {
    expect(readJsonc('{"a": [1, "two", null, true]}')).toEqual({ ok: true, json: { a: [1, 'two', null, true] } });
  });

  it('reads line and block comments, and trailing commas in objects and arrays', () => {
    expect(readJsonc('{\n  // a\n  "a": [1, 2,], /* b */\n  "b": { "c": 3, },\n}\n')).toEqual({ ok: true, json: { a: [1, 2], b: { c: 3 } } });
  });

  it('reads past a byte-order mark, and counts columns without it', () => {
    expect(readJsonc('﻿{"a": 1}')).toEqual({ ok: true, json: { a: 1 } });
    expect(readJsonc('﻿{"a" 1}')).toEqual({ ok: false, error: 'expected a colon at line 1, column 6' });
  });

  it('names the first mistake by line and column, counted from 1', () => {
    expect(readJsonc('{\n  "a": 1\n  "b": 2\n}')).toEqual({ ok: false, error: 'expected a comma at line 3, column 3' });
    expect(readJsonc('{\r\n  "a": 1\r\n  "b": 2\r\n}')).toEqual({ ok: false, error: 'expected a comma at line 3, column 3' });
  });

  it('names only the first of several mistakes, and never hands back what the parser made of the rest', () => {
    expect(readJsonc('{ "a": 1 "b": 2 "c" }')).toEqual({ ok: false, error: 'expected a comma at line 1, column 10' });
  });

  it('says a file cut short goes wrong at its end, an empty one included', () => {
    expect(readJsonc('{ "a": [1, 2')).toEqual({ ok: false, error: 'expected a closing ] at the end of the file' });
    expect(readJsonc('')).toEqual({ ok: false, error: 'expected a value at the end of the file' });
    expect(readJsonc('// only a comment\n')).toEqual({ ok: false, error: 'expected a value at the end of the file' });
  });

  it('words the mistakes a person makes most', () => {
    expect(readJsonc("{ 'a': 1 }")).toEqual({ ok: false, error: 'an unexpected character at line 1, column 3' });
    expect(readJsonc('{ a: 1 }')).toEqual({ ok: false, error: 'an unexpected character at line 1, column 3' });
    expect(readJsonc('{ "a": 1,')).toEqual({ ok: false, error: 'expected a property name in double quotes at the end of the file' });
    expect(readJsonc('{ "a": "one\n" }')).toEqual({ ok: false, error: 'a string that is never closed at line 1, column 8' });
    expect(readJsonc('{ "a": 1 } { "b": 2 }')).toEqual({ ok: false, error: 'expected nothing more after the value at line 1, column 12' });
    expect(readJsonc('{ "a": 1 /* open')).toEqual({ ok: false, error: 'a comment that is never closed at line 1, column 10' });
  });
});

describe('the keys a file names more than once', () => {
  it('are the top object’s, each once, in the order their second naming comes', () => {
    expect(duplicateKeys('{ "a": 1, "b": 2, "b": 3, "a": 4, "a": 5, "c": 6 }')).toEqual(['b', 'a']);
    expect(duplicateKeys('{\n  // a comment\n  "a": 1,\n  "a": 2,\n}\n')).toEqual(['a']);
  });

  it('leave out a key named again only inside a value, and are none for a text holding no object', () => {
    expect(duplicateKeys('{ "a": { "x": 1, "x": 2 }, "b": [{ "a": 1 }] }')).toEqual([]);
    expect(duplicateKeys('[1, 1]')).toEqual([]);
    expect(duplicateKeys('')).toEqual([]);
  });

  it('are keys of which the parser keeps the last', () => {
    expect(duplicateKeys('{ "a": 1, "a": 2 }')).toEqual(['a']);
    expect(readJsonc('{ "a": 1, "a": 2 }')).toEqual({ ok: true, json: { a: 2 } });
  });
});
