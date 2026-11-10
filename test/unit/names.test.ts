import { readdirSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../src/', import.meta.url));

/** Names that say nothing of what a file holds, so anything can be put in one: a module is named after its area or its concept. */
const CATCH_ALL = new Set(['logic', 'utils', 'util', 'misc', 'common', 'stuff']);

describe('the source', () => {
  it('names no file for no concept at all', () => {
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' });
    expect(files.filter((file) => CATCH_ALL.has(basename(file, extname(file)))).map((file) => join('src', file))).toEqual([]);
  });
});
