import { describe, expect, it } from 'vitest';
import { tracked } from './tracked';

/**
 * A pointer into a document, `docs/architecture.md § A heading`, names a heading that document has.
 * It may leave out the heading's subtitle, after a colon or a dash (`§ Tab lifecycle` for "Tab lifecycle: a tab can exist without a process"), and its code spans' backticks.
 * A heading renamed without its pointers leaves them pointing at nothing, and nothing else notices: one pointed at a heading the docs never had.
 */
const POINTER = /([\w./-]+\.md) § ([^.,;:)\n*]+)/g;

/** A heading or a pointer's name as they are compared: no backticks, no space at either end. */
const plain = (name: string): string => name.replace(/`/g, '').trim();

/** Whether `heading` is the one `name` points at, its subtitle left out or not. */
const named = (heading: string, name: string): boolean => heading === name || heading.startsWith(`${name}:`) || heading.startsWith(`${name} —`);

/** Each pointer in `files` whose document is not among them or has no heading of that name, as `file:line: pointer`. */
function deadPointers(files: { file: string; text: string }[]): string[] {
  const headings = new Map(files.map(({ file, text }) => [file, text.split('\n').flatMap((line) => /^#+\s+(.*)$/.exec(line)?.[1] ?? []).map(plain)]));
  return files.flatMap(({ file, text }) =>
    text.split('\n').flatMap((line, i) =>
      [...line.matchAll(POINTER)]
        .filter(([, doc, name]) => !(headings.get(doc) ?? []).some((heading) => named(heading, plain(name))))
        .map(([pointer]) => `${file}:${i + 1}: ${pointer.trim()}`),
    ),
  );
}

describe('pointers into the docs', () => {
  it('each name a heading that exists', () => {
    // This file's own pointers are examples.
    expect(deadPointers(tracked(/\.(ts|mjs|css|md|yml|sh|toml)$/).filter(({ file }) => file !== 'test/unit/pointers.test.ts'))).toEqual([]);
  });

  it('what counts as a dead pointer, and what does not', () => {
    const doc = { file: 'docs/a.md', text: '# A\n\n## The window’s checks\n\n### Tab lifecycle: a tab can exist without a process\n\n### The `terminal` type\n' };
    expect(deadPointers([doc, { file: 'b.ts', text: '// See docs/a.md § The window’s checks.' }])).toEqual([]);
    expect(deadPointers([doc, { file: 'b.ts', text: '// See docs/a.md § Tab lifecycle, and docs/a.md § The `terminal` type.' }])).toEqual([]);
    expect(deadPointers([doc, { file: 'b.ts', text: '// See docs/a.md § The attention strip.' }])).toEqual(['b.ts:1: docs/a.md § The attention strip']);
    expect(deadPointers([doc, { file: 'b.ts', text: '// See docs/gone.md § A.' }])).toEqual(['b.ts:1: docs/gone.md § A']);
  });
});
