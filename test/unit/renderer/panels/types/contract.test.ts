import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { KINDS, MANIFEST_FIELDS, MANIFEST_OPTION_KINDS, OPTION_FIELDS, checkManifest } from '../../../../../src/renderer/panels/types/folder';
import { LIST_FIELDS, TONES, readListDocument } from '../../../../../src/renderer/panels/types/listdoc';

// docs/panel-types.md is the contract a type is written against, and these are the checkers that read it: a field one names that the other does not is the drift this holds shut.
const doc = readFileSync(new URL('../../../../../docs/panel-types.md', import.meta.url), 'utf8');
const lines = doc.split('\n');

/** The field names in the first column of the table under `heading`. */
function tableFields(heading: string): string[] {
  const start = lines.indexOf(heading);
  expect(start, `docs/panel-types.md has no "${heading}"`).toBeGreaterThanOrEqual(0);
  const fields: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('#')) break;
    const match = /^\| `([^`]+)` \|/.exec(line);
    if (match) fields.push(match[1]);
  }
  return fields;
}

/** The names in backticks after the colon of the line starting with `prefix`. */
function listed(prefix: string): string[] {
  const line = lines.find((text) => text.startsWith(prefix));
  expect(line, `docs/panel-types.md has no line starting "${prefix}"`).toBeDefined();
  return [...line!.slice(line!.indexOf(':')).matchAll(/`([a-z]+)`/g)].map((match) => match[1]);
}

/** Every JSON block the document marks `<!-- checked: kind -->`. */
function checkedBlocks(kind: string): string[] {
  const blocks: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (line !== `<!-- checked: ${kind} -->` || lines[index + 1] !== '```json') continue;
    const end = lines.indexOf('```', index + 2);
    blocks.push(lines.slice(index + 2, end).join('\n'));
  }
  return blocks;
}

/** A list in order, so the document may name fields in the order that reads best. */
const sorted = (names: readonly string[]): string[] => [...names].sort();

describe('docs/panel-types.md', () => {
  it('names every field of panel.json and of an option in it, and no other', () => {
    expect(sorted(tableFields('### `panel.json`'))).toEqual(sorted(MANIFEST_FIELDS));
    expect(sorted(tableFields('### An option'))).toEqual(sorted(OPTION_FIELDS));
  });

  it('names every kind, and every kind an option can be', () => {
    expect(sorted(listed('`kind` is one of:'))).toEqual(sorted(KINDS));
    expect(sorted(listed("An option's `kind` is one of:"))).toEqual(sorted(MANIFEST_OPTION_KINDS));
  });

  it('names every field of the list a script prints, at every level, and no other', () => {
    expect(sorted(tableFields('### The list'))).toEqual(sorted(LIST_FIELDS.document));
    expect(sorted(tableFields('### A section'))).toEqual(sorted(LIST_FIELDS.section));
    expect(sorted(tableFields('### An item'))).toEqual(sorted(LIST_FIELDS.item));
    expect(sorted(tableFields('### An action'))).toEqual(sorted(LIST_FIELDS.action));
    expect(sorted(tableFields('### A `session` action'))).toEqual(sorted(LIST_FIELDS.session));
    expect(sorted(listed('`tone` is one of:'))).toEqual(sorted(TONES));
  });

  it('shows a panel.json the app reads without a word to say about it', () => {
    const blocks = checkedBlocks('manifest');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const checked = checkManifest({ name: 'example', dir: '/types/example', status: 'read', error: null, json: JSON.parse(block) });
      expect(checked.problems).toEqual([]);
      expect(checked.notes).toEqual([]);
    }
  });

  it('shows a list the app draws', () => {
    const blocks = checkedBlocks('list');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) expect(readListDocument(block).problems).toEqual([]);
  });
});
