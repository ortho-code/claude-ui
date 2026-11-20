import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../../../../src/shared/diff/types';
import { closed, keyOf, kept, NO_TABS, opened, picked, reordered, stepped, updated, type EditorTabs, type FileRef } from '../../../../src/renderer/state/editor-tabs';

const file = (path: string): DiffFile => ({ path, from: null, status: 'M', added: 1, deleted: 0, binary: false, generated: false });
const FILES = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({ root: '/repo', question: 'since' as const, against: 'aaaaaaa', file: file(path) }));
const ref = (path: string, against = 'aaaaaaa'): FileRef => ({ root: '/repo', file: file(path), diff: { question: 'since', against }, files: FILES });
const key = (path: string): string => keyOf(ref(path));

/** The set as its tabs' paths, a preview marked with `*`, and the one on show. */
const said = (set: EditorTabs): { tabs: string[]; active: string | null } => ({
  tabs: set.tabs.map((tab) => `${tab.ref.file.path}${tab.preview ? '*' : ''}`),
  active: set.active === null ? null : (set.tabs.find((tab) => tab.key === set.active)?.ref.file.path ?? 'gone'),
});

describe('opening a file', () => {
  it('opens a preview, which the next file opened without keeping takes the place of', () => {
    const one = opened(NO_TABS, ref('a.ts'), false);
    expect(said(one)).toEqual({ tabs: ['a.ts*'], active: 'a.ts' });
    expect(said(opened(one, ref('b.ts'), false))).toEqual({ tabs: ['b.ts*'], active: 'b.ts' });
  });

  it('kept, opens a tab of its own beside the preview, which stays', () => {
    const one = opened(NO_TABS, ref('a.ts'), false);
    expect(said(opened(one, ref('b.ts'), true))).toEqual({ tabs: ['a.ts*', 'b.ts'], active: 'b.ts' });
  });

  it('already open, puts its tab on show, keeps it when asked, and takes the newer comparison', () => {
    const two = opened(opened(NO_TABS, ref('a.ts'), true), ref('b.ts'), false);
    const again = opened(two, ref('a.ts', 'bbbbbbb'), false);
    expect(said(again)).toEqual({ tabs: ['a.ts', 'b.ts*'], active: 'a.ts' });
    expect(again.tabs[0].ref.diff.against).toBe('bbbbbbb');
    expect(said(opened(again, ref('b.ts'), true))).toEqual({ tabs: ['a.ts', 'b.ts'], active: 'b.ts' });
  });
});

describe('a tab', () => {
  const three = opened(opened(opened(NO_TABS, ref('a.ts'), true), ref('b.ts'), true), ref('c.ts'), false);

  it('is kept, so the next file opened takes a tab of its own', () => {
    expect(said(opened(kept(three, key('c.ts')), ref('a.ts'), false))).toEqual({ tabs: ['a.ts', 'b.ts', 'c.ts'], active: 'a.ts' });
  });

  it('is put on show, and a key the set does not have changes nothing', () => {
    expect(said(picked(three, key('a.ts'))).active).toBe('a.ts');
    expect(picked(three, 'file:/elsewhere')).toBe(three);
  });

  it('closed while on show gives way to the tab after it, else the one before, and the last leaves none', () => {
    const middle = picked(three, key('b.ts'));
    expect(said(closed(middle, key('b.ts')))).toEqual({ tabs: ['a.ts', 'c.ts*'], active: 'c.ts' });
    expect(said(closed(three, key('c.ts')))).toEqual({ tabs: ['a.ts', 'b.ts'], active: 'b.ts' });
    expect(closed(opened(NO_TABS, ref('a.ts'), false), key('a.ts'))).toEqual(NO_TABS);
  });

  it('closed while another is on show leaves that one on show', () => {
    expect(said(closed(three, key('a.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'c.ts' });
  });

  it('stepped to another file stays in its place and keeps being a preview', () => {
    expect(said(stepped(picked(three, key('a.ts')), key('a.ts'), ref('c.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'c.ts' });
    const preview = opened(NO_TABS, ref('a.ts'), false);
    expect(said(stepped(preview, key('a.ts'), ref('b.ts')))).toEqual({ tabs: ['b.ts*'], active: 'b.ts' });
  });

  it('stepped to a file with a tab of its own puts that tab on show and goes, so no file has two', () => {
    expect(said(stepped(picked(three, key('a.ts')), key('a.ts'), ref('b.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'b.ts' });
  });

  it('takes a newer comparison in its place, staying as it is and where it is', () => {
    const after = updated(three, key('a.ts'), ref('a.ts', 'bbbbbbb'));
    expect(said(after)).toEqual(said(three));
    expect(after.tabs[0].ref.diff.against).toBe('bbbbbbb');
  });

  it('takes the order a drag leaves, a tab the order leaves out kept at the end', () => {
    expect(said(reordered(three, [key('c.ts'), key('a.ts'), 'file:/gone'])).tabs).toEqual(['c.ts*', 'a.ts', 'b.ts']);
  });
});
