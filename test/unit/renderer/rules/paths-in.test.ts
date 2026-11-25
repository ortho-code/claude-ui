import { describe, expect, it } from 'vitest';
import { cellText, fileOfUri, pathsIn } from '../../../../src/renderer/rules/paths-in';

/** A row as xterm holds it: each cell's characters, a wide one's second half as `''` of width 0. */
const cellsOf = (chars: string[], widths: Record<number, number> = {}) => (x: number) => ({ chars: chars[x] ?? '', width: widths[x] ?? 1 });

describe('cellText', () => {
  it('names the cell of every UTF-16 unit, so a path after an emoji or a wide character still has its own cells', () => {
    // As xterm holds `🎉 中 src/a.ts`: the emoji and the character each fill a cell, and the next one is their second half.
    const row = ['🎉', '', ' ', '中', '', ' ', 's', 'r', 'c', '/', 'a', '.', 't', 's'];
    const { text, cells } = cellText(row.length, cellsOf(row, { 1: 0, 4: 0 }));
    const [match] = pathsIn(text);
    expect([cells[match.start], cells[match.end - 1]]).toEqual([6, 13]);
  });

  it('reads a cell nothing was written to as a space, so words a program put apart by moving the cursor stay apart', () => {
    const row = ['s', 'e', 'e', '', 'R', 'E', 'A', 'D', 'M', 'E', '.', 'm', 'd'];
    const { text } = cellText(row.length, cellsOf(row));
    expect(pathsIn(text).map((match) => match.path)).toEqual(['README.md']);
  });
});

/** Each piece as the path and line it names, and the text it covers. */
const said = (text: string): [string, number | null, string][] => pathsIn(text).map((match) => [match.path, match.line, text.slice(match.start, match.end)]);

describe('fileOfUri', () => {
  it('names the file of a `file://` link on this machine, its line from the fragment, an escaped name decoded', () => {
    expect(fileOfUri('file:///home/me/my%20notes.md')).toEqual({ path: '/home/me/my notes.md', line: null });
    expect(fileOfUri('file://localhost/home/me/a.ts#L42')).toEqual({ path: '/home/me/a.ts', line: 42 });
    expect(fileOfUri('file:///home/me/a.ts#7')).toEqual({ path: '/home/me/a.ts', line: 7 });
  });

  it('names none for a web link, another host, a broken escape, or no link at all', () => {
    expect([fileOfUri('https://example.com/a.ts'), fileOfUri('file://server/share/a.ts'), fileOfUri('file:///a/%E0%A4%A.ts'), fileOfUri('not a link')]).toEqual([null, null, null, null]);
  });
});

describe('pathsIn', () => {
  it('finds absolute, home and relative paths, a relative one by its folder or its extension', () => {
    expect(said('Edited /tmp/a/b.md, ~/notes/todo.md and src/main/touched.ts, then package.json')).toEqual([
      ['/tmp/a/b.md', null, '/tmp/a/b.md'],
      ['~/notes/todo.md', null, '~/notes/todo.md'],
      ['src/main/touched.ts', null, 'src/main/touched.ts'],
      ['package.json', null, 'package.json'],
    ]);
  });

  it('takes a line number, and a column after it, into the piece', () => {
    expect(said('see src/a.ts:42 and src/b.ts:7:3.')).toEqual([
      ['src/a.ts', 42, 'src/a.ts:42'],
      ['src/b.ts', 7, 'src/b.ts:7:3'],
    ]);
  });

  it('leaves a full stop ending a sentence, brackets and quotes off a path', () => {
    expect(said('It is in (src/a.ts). See `docs/guide.md` and "x/y.ts".')).toEqual([
      ['src/a.ts', null, 'src/a.ts'],
      ['docs/guide.md', null, 'docs/guide.md'],
      ['x/y.ts', null, 'x/y.ts'],
    ]);
  });

  it("leaves out URLs, flags, numbers, a word with no folder or extension, and `~` that is not the home folder", () => {
    expect(said('Open https://example.com/docs/a.md with --flag/value, version 1.5.2, done, a~b/c.ts')).toEqual([]);
  });
});
