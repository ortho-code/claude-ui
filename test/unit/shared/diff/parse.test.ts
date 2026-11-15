import { describe, expect, it } from 'vitest';
import { parseNameStatus, parseNumstat, parseUnified } from '../../../../src/shared/diff/parse';

describe('parseNumstat', () => {
  it('reads counts, a binary file as no counts, and a rename with both paths', () => {
    const text = ['3\t1\ta.txt', '-\t-\timage.png', '2\t0\t', 'old name.txt', 'new name.txt', ''].join('\0');
    expect(parseNumstat(text)).toEqual([
      { path: 'a.txt', from: null, added: 3, deleted: 1 },
      { path: 'image.png', from: null, added: null, deleted: null },
      { path: 'new name.txt', from: 'old name.txt', added: 2, deleted: 0 },
    ]);
  });
});

describe('parseNameStatus', () => {
  it('reads a letter per new path, a rename or copy with its old path', () => {
    const text = ['M', 'a.txt', 'R087', 'old.txt', 'new.txt', 'C100', 'src.txt', 'copy.txt', 'D', 'gone.txt', ''].join('\0');
    expect([...parseNameStatus(text)]).toEqual([
      ['a.txt', { status: 'M', from: null }],
      ['new.txt', { status: 'R', from: 'old.txt' }],
      ['copy.txt', { status: 'C', from: 'src.txt' }],
      ['gone.txt', { status: 'D', from: null }],
    ]);
  });
});

describe('parseUnified', () => {
  const header = ['diff --git a/f.rs b/f.rs', 'index 1..2 100644', '--- a/f.rs', '+++ b/f.rs'];

  it("numbers each side's lines from the hunk header, and counts the gap before each hunk", () => {
    const raw = [...header, '@@ -5,3 +5,3 @@ fn main()', ' keep', '-old', '+new', ' keep', '@@ -20,1 +20,2 @@', ' end', '+added', ''].join('\n');
    const { hunks } = parseUnified(raw);
    expect(hunks.map((h) => [h.oldStart, h.newStart, h.heading, h.gapBefore])).toEqual([
      [5, 5, 'fn main()', 4],
      [20, 20, '', 12],
    ]);
    expect(hunks[0].rows).toEqual([
      { kind: 'context', old: 5, new: 5, text: 'keep' },
      { kind: 'del', old: 6, new: null, text: 'old' },
      { kind: 'add', old: null, new: 6, text: 'new' },
      { kind: 'context', old: 7, new: 7, text: 'keep' },
    ]);
  });

  it('reads the ranges only between the two @@, so code in the heading is not read as one', () => {
    const raw = [...header, '@@ -10,1 +12,1 @@ fn f() -> Result<()> { count += 1; }', '-a', '+b', ''].join('\n');
    expect(parseUnified(raw).hunks[0]).toMatchObject({ oldStart: 10, newStart: 12, heading: 'fn f() -> Result<()> { count += 1; }' });
  });

  it('takes a removed line that starts with --- as content once a hunk has begun', () => {
    const raw = [...header, '@@ -1,2 +1,1 @@', '---- a heading rule', ' kept', ''].join('\n');
    expect(parseUnified(raw).hunks[0].rows[0]).toEqual({ kind: 'del', old: 1, new: null, text: '--- a heading rule' });
  });

  it('marks the row git says has no newline at the end, and keeps an empty unchanged line', () => {
    const raw = [...header, '@@ -1,2 +1,2 @@', ' ', '-last', '\\ No newline at end of file', '+last', ''].join('\n');
    const rows = parseUnified(raw).hunks[0].rows;
    expect(rows[0]).toEqual({ kind: 'context', old: 1, new: 1, text: '' });
    expect(rows[1]).toEqual({ kind: 'del', old: 2, new: null, text: 'last', noEol: true });
    expect(rows[2]?.noEol).toBeUndefined();
  });

  it('says a binary file is one, with no hunks', () => {
    expect(parseUnified(['diff --git a/x b/x', 'Binary files a/x and b/x differ', ''].join('\n'))).toEqual({ hunks: [], binary: true });
  });

  it('starts a new file at line 1 with nothing before it', () => {
    const raw = ['diff --git a/n b/n', 'new file mode 100644', '--- /dev/null', '+++ b/n', '@@ -0,0 +1,2 @@', '+one', '+two', ''].join('\n');
    const [hunk] = parseUnified(raw).hunks;
    expect(hunk).toMatchObject({ newStart: 1, gapBefore: 0 });
    expect(hunk.rows.map((r) => r.new)).toEqual([1, 2]);
  });
});
