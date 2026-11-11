import { describe, it, expect } from 'vitest';
import { orderAsTabs, reorderWithinGroup } from '../../../../src/renderer/rules/tab-order';

describe('reorderWithinGroup', () => {
  const key = (t: { id: string; g: string }) => t.g;
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it('reorders within a single group', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' }, c = { id: 'c', g: 'x' };
    expect(ids(reorderWithinGroup([a, b, c], key, a, 2))).toEqual(['b', 'c', 'a']);
  });

  it('leaves other groups in their slots', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'y' }, c = { id: 'c', g: 'x' };
    // Move c to the front of group x; y keeps its slot (index 1).
    expect(ids(reorderWithinGroup([a, b, c], key, c, 0))).toEqual(['c', 'b', 'a']);
  });

  it('clamps the index and no-ops an item that is not present', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' };
    expect(ids(reorderWithinGroup([a, b], key, a, 9))).toEqual(['b', 'a']);
    expect(ids(reorderWithinGroup([a, b], key, { id: 'z', g: 'x' }, 0))).toEqual(['a', 'b']);
  });
});

describe('orderAsTabs', () => {
  /** An item to place: its project, its group ('' for none), and a name to assert on. */
  const at = (item: string, repoRoot: string, groupId = '') => ({ repoRoot, groupId, item });
  /** The group registry, in the order the sidebar and the tab bar both use. */
  const groups = (byRoot: Record<string, string[]>) => (root: string) => byRoot[root] ?? [];
  const flat = (out: ReturnType<typeof orderAsTabs<string>>) => out.flatMap((c) => c.items);

  it('follows the given project order', () => {
    const out = orderAsTabs([at('a', '/late'), at('b', '/early')], groups({}), ['/early', '/late']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/early', '/late']);
  });

  // Without a project order, projects come in the order they are met.
  it('falls back to the order projects first appear', () => {
    const out = orderAsTabs([at('a', '/second'), at('b', '/first')], groups({}));
    expect(out.map((c) => c.repoRoot)).toEqual(['/second', '/first']);
  });

  /**
   * The shape the tab bar draws: a project's ungrouped tabs first, then one run per group in REGISTRY order — not the order the tabs happen to sit in.
   */
  it('puts ungrouped items first, then each group in registry order', () => {
    const out = orderAsTabs(
      [at('in-g2', '/repo', 'g2'), at('loose-1', '/repo'), at('in-g1', '/repo', 'g1'), at('loose-2', '/repo')],
      groups({ '/repo': ['g1', 'g2'] }),
    );
    expect(out.map((c) => c.groupId)).toEqual(['', 'g1', 'g2']);
    expect(flat(out)).toEqual(['loose-1', 'loose-2', 'in-g1', 'in-g2']);
  });

  // Within a run, the caller's order is passed through untouched — no recency, no pins, no urgency.
  // Sorting by any of those is what made rows swap while they were being read.
  it('leaves a run in the order it was handed', () => {
    const out = orderAsTabs([at('c', '/repo'), at('a', '/repo'), at('b', '/repo')], groups({}));
    expect(flat(out)).toEqual(['c', 'a', 'b']);
  });

  // Moving a session into a group moves it in the bar.
  it('moves an item when its group changes, without anything else moving', () => {
    const entries = [at('a', '/repo'), at('b', '/repo'), at('c', '/repo')];
    expect(flat(orderAsTabs(entries, groups({ '/repo': ['g1'] })))).toEqual(['a', 'b', 'c']);
    const regrouped = [at('a', '/repo'), at('b', '/repo', 'g1'), at('c', '/repo')];
    expect(flat(orderAsTabs(regrouped, groups({ '/repo': ['g1'] })))).toEqual(['a', 'c', 'b']);
  });

  // A group belonging to another project cannot be drawn under this one; the item is loose here rather than vanishing, which is what the sidebar's tree does too.
  it('treats a group this project does not own as no group at all', () => {
    const out = orderAsTabs([at('a', '/repo', 'group-of-elsewhere')], groups({ '/repo': ['g1'] }));
    expect(out).toEqual([{ repoRoot: '/repo', groupId: '', items: ['a'] }]);
  });

  it('keeps a project the order has never seen, rather than dropping it', () => {
    const out = orderAsTabs([at('a', '/unknown')], groups({}), ['/known']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/unknown']);
  });

  it('omits a group with nothing open in it', () => {
    const out = orderAsTabs([at('a', '/repo')], groups({ '/repo': ['empty-group'] }));
    expect(out.map((c) => c.groupId)).toEqual(['']);
  });
});
