import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../../../../src/shared/diff/types';
import { allTabs, closed, inGroupOf, keyOf, kept, NO_GROUP, NO_TABS, opened, openedIn, pathOf, picked, reordered, shownTab, stepped, steppedIn, updated, type CheckoutFileRef, type EditorGroup, type FileRef } from '../../../../src/renderer/state/editor-tabs';

const file = (path: string): DiffFile => ({ path, from: null, status: 'M', added: 1, deleted: 0, binary: false, generated: false });
const FILES = ['a.ts', 'b.ts', 'c.ts'].map((path) => ({ root: '/repo', question: 'since' as const, against: 'aaaaaaa', file: file(path) }));
const ref = (path: string, against = 'aaaaaaa'): CheckoutFileRef => ({ kind: 'checkout', root: '/repo', file: file(path), diff: { question: 'since', against }, files: FILES });
const key = (path: string): string => keyOf(ref(path));
/** A tab's file by its path from the repository, as `ref` names it. */
const named = (shown: FileRef): string => pathOf(shown).slice('/repo/'.length);
/** The commit a tab's file is compared with. */
const against = (shown: FileRef | undefined): string | null => (shown?.kind === 'checkout' ? shown.diff.against : null);

/** The group as its tabs' paths, a preview marked with `*`, and the one on show. */
const said = (group: EditorGroup): { tabs: string[]; active: string | null } => {
  const active = group.tabs.find((tab) => tab.key === group.active);
  return { tabs: group.tabs.map((tab) => `${named(tab.ref)}${tab.preview ? '*' : ''}`), active: group.active === null ? null : active ? named(active.ref) : 'gone' };
};

describe('opening a file', () => {
  it('opens a preview, which the next file opened without keeping takes the place of', () => {
    const one = opened(NO_GROUP, ref('a.ts'), false);
    expect(said(one)).toEqual({ tabs: ['a.ts*'], active: 'a.ts' });
    expect(said(opened(one, ref('b.ts'), false))).toEqual({ tabs: ['b.ts*'], active: 'b.ts' });
  });

  it('kept, opens a tab of its own beside the preview, which stays', () => {
    const one = opened(NO_GROUP, ref('a.ts'), false);
    expect(said(opened(one, ref('b.ts'), true))).toEqual({ tabs: ['a.ts*', 'b.ts'], active: 'b.ts' });
  });

  it('already open, puts its tab on show, keeps it when asked, and takes the newer comparison', () => {
    const two = opened(opened(NO_GROUP, ref('a.ts'), true), ref('b.ts'), false);
    const again = opened(two, ref('a.ts', 'bbbbbbb'), false);
    expect(said(again)).toEqual({ tabs: ['a.ts', 'b.ts*'], active: 'a.ts' });
    expect(against(again.tabs[0]?.ref)).toBe('bbbbbbb');
    expect(said(opened(again, ref('b.ts'), true))).toEqual({ tabs: ['a.ts', 'b.ts'], active: 'b.ts' });
  });
});

describe('a tab', () => {
  const three = opened(opened(opened(NO_GROUP, ref('a.ts'), true), ref('b.ts'), true), ref('c.ts'), false);

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
    expect(closed(opened(NO_GROUP, ref('a.ts'), false), key('a.ts'))).toEqual(NO_GROUP);
  });

  it('closed while another is on show leaves that one on show', () => {
    expect(said(closed(three, key('a.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'c.ts' });
  });

  it('stepped to another file stays in its place and keeps being a preview', () => {
    expect(said(stepped(picked(three, key('a.ts')), key('a.ts'), ref('c.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'c.ts' });
    const preview = opened(NO_GROUP, ref('a.ts'), false);
    expect(said(stepped(preview, key('a.ts'), ref('b.ts')))).toEqual({ tabs: ['b.ts*'], active: 'b.ts' });
  });

  it('stepped to a file with a tab of its own puts that tab on show and goes, so no file has two', () => {
    expect(said(stepped(picked(three, key('a.ts')), key('a.ts'), ref('b.ts')))).toEqual({ tabs: ['b.ts', 'c.ts*'], active: 'b.ts' });
  });

  it('takes a newer comparison in its place, staying as it is and where it is', () => {
    const after = updated(three, key('a.ts'), ref('a.ts', 'bbbbbbb'));
    expect(said(after)).toEqual(said(three));
    expect(against(after.tabs[0]?.ref)).toBe('bbbbbbb');
  });

  it('takes the order a drag leaves, a tab the order leaves out kept at the end', () => {
    expect(said(reordered(three, [key('c.ts'), key('a.ts'), 'file:/gone'])).tabs).toEqual(['c.ts*', 'a.ts', 'b.ts']);
  });
});

describe('the set', () => {
  /** Two groups, as no rule makes them yet: a.ts and b.ts, then c.ts. */
  const first = opened(opened(NO_GROUP, ref('a.ts'), true), ref('b.ts'), true);
  const second = opened(NO_GROUP, ref('c.ts'), true);
  const split = { groups: [first, second] };

  it('of no files opens a file in a group of its own', () => {
    expect(NO_TABS.groups).toEqual([]);
    expect(openedIn(NO_TABS, ref('a.ts'), false).groups.map(said)).toEqual([{ tabs: ['a.ts*'], active: 'a.ts' }]);
  });

  it('opens a file already open in the group that has it, and another in the first', () => {
    expect(openedIn(split, ref('c.ts', 'bbbbbbb'), false).groups.map(said)).toEqual([said(first), { tabs: ['c.ts'], active: 'c.ts' }]);
    expect(openedIn(split, ref('d.ts'), false).groups.map(said)).toEqual([{ tabs: ['a.ts', 'b.ts', 'd.ts*'], active: 'd.ts' }, said(second)]);
  });

  it('changes only the group holding a tab, and a key no group holds changes nothing', () => {
    expect(inGroupOf(split, key('c.ts'), (group) => kept(group, key('c.ts'))).groups[0]).toBe(first);
    expect(inGroupOf(split, 'file:/elsewhere', () => NO_GROUP)).toBe(split);
  });

  it('loses a group whose last tab closes, and with the last group the set holds none', () => {
    const one = inGroupOf(split, key('c.ts'), (group) => closed(group, key('c.ts')));
    expect(one.groups.map(said)).toEqual([said(first)]);
    expect(inGroupOf(one, key('a.ts'), () => NO_GROUP)).toEqual(NO_TABS);
  });

  it('steps a tab in its own group', () => {
    expect(steppedIn(split, key('c.ts'), ref('d.ts')).groups.map(said)).toEqual([said(first), { tabs: ['d.ts'], active: 'd.ts' }]);
  });

  it('shows the tab on show in its first group, and lists every tab group after group', () => {
    expect(shownTab(split)?.key).toBe(key('b.ts'));
    expect(shownTab(NO_TABS)).toBeUndefined();
    expect(allTabs(split).map((tab) => named(tab.ref))).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});
