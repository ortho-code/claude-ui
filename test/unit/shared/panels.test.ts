import { describe, it, expect } from 'vitest';

import { withLink, type PanelData } from '../../../src/shared/panels';

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
