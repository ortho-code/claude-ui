import { describe, it, expect } from 'vitest';

import { nodeStateProblem, parseSize, spelledSize, withLink, withNodeChanges, type NodeState, type PanelData } from '../../../src/shared/panels';

// Main's own tests (test/unit/main/paneldata.test.ts) hold what the file ends up with, pruning included; this holds what the window's checks rely on too: a new value, the given one untouched.
describe('withLink', () => {
  it('adds the link from the time given and remembers the group, keeping the other links and projects', () => {
    const data: PanelData = { sessions: { s1: { key: 'a', label: 'A', href: null, startedAt: 't1' } }, lastGroup: { '/other': 'g-other' } };
    const next = withLink(data, 's2', { key: 'b', label: 'B', href: 'https://example.com/b' }, { repoRoot: '/repo', groupId: 'g1' }, 't2');
    expect(next).toEqual({
      sessions: { s1: { key: 'a', label: 'A', href: null, startedAt: 't1' }, s2: { key: 'b', label: 'B', href: 'https://example.com/b', startedAt: 't2' } },
      lastGroup: { '/other': 'g-other', '/repo': 'g1' },
    });
    expect(withLink(next, 's3', { key: 'c', label: 'C', href: null }, { repoRoot: '/repo', groupId: null }, 't3').lastGroup['/repo']).toBeNull();
    expect(data).toEqual({ sessions: { s1: { key: 'a', label: 'A', href: null, startedAt: 't1' } }, lastGroup: { '/other': 'g-other' } });
  });
});

describe('a node’s size', () => {
  it('reads a positive number as a share and "<n>px" as pixels, and nothing else', () => {
    expect(parseSize(0.3)).toEqual({ share: 0.3 });
    expect(parseSize('320px')).toEqual({ px: 320 });
    expect(parseSize('12.5px')).toEqual({ px: 12.5 });
    for (const not of [0, -1, '0px', '320', 'px', null, true, Number.NaN, Infinity]) expect(parseSize(not)).toBeNull();
  });

  it('is spelled back as the file spells it', () => {
    expect(spelledSize({ px: 280 })).toBe('280px');
    expect(spelledSize({ share: 0.25 })).toBe(0.25);
  });
});

describe('what the app keeps for a node', () => {
  it('names a value a field may not hold', () => {
    expect(nodeStateProblem('size', '280px')).toBeNull();
    expect(nodeStateProblem('size', 'wide')).toBe('size is not a positive number or a pixel size like "320px".');
    expect(nodeStateProblem('folded', 'yes')).toBe('folded is not true or false.');
    expect(nodeStateProblem('active', 'Checks')).toBe('active is not the id of a panel.');
    expect(nodeStateProblem('active', 'checks')).toBeNull();
  });

  it('sets and removes fields in order, removes a node left with nothing, and leaves the nodes it was given alone', () => {
    const nodes: Record<string, NodeState> = { right: { folded: true, active: 'checks' }, sidebar: { size: '280px' } };
    const next = withNodeChanges(nodes, [
      { id: 'right', field: 'folded', value: null },
      { id: 'sidebar', field: 'size', value: null },
      { id: 'drawer', field: 'size', value: 0.25 },
      { id: 'drawer', field: 'size', value: 0.3 },
    ]);
    expect(next).toEqual({ right: { active: 'checks' }, drawer: { size: 0.3 } });
    expect(nodes).toEqual({ right: { folded: true, active: 'checks' }, sidebar: { size: '280px' } });
  });
});
