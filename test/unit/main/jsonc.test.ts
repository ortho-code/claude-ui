import { describe, it, expect } from 'vitest';
import { readJsonc } from '../../../src/main/jsonc';

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
