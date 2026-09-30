import { describe, it, expect } from 'vitest';

import { createdGroup, movedGroup, movedProject, moveTarget, renamedGroup, withoutGroup, withSessionInGroup } from '../../../src/shared/grouping';
import type { GroupState } from '../../../src/shared/types';

// Main's own tests (test/unit/main/meta.test.ts) hold what meta.json ends up with; these hold what the window's checks rely on too: a new value every time something changes, the given one untouched.
const state = (): GroupState => ({
  groups: [
    { id: 'a1', name: 'A one', repoRoot: '/a' },
    { id: 'b1', name: 'B one', repoRoot: '/b' },
    { id: 'a2', name: 'A two', repoRoot: '/a' },
  ],
  groupOf: { s1: 'a1', s2: 'a2' },
});

describe('moveTarget', () => {
  it('lands a move, and answers null for one that falls off an end or goes nowhere', () => {
    expect(moveTarget(2, 3, 'top')).toBe(0);
    expect(moveTarget(1, 3, 'bottom')).toBe(3);
    expect(moveTarget(1, 3, 'up')).toBe(0);
    expect(moveTarget(1, 3, 'down')).toBe(2);
    expect(moveTarget(0, 3, 'up')).toBeNull();
    expect(moveTarget(3, 3, 'down')).toBeNull();
    expect(moveTarget(0, 3, 'top')).toBeNull();
  });
});

describe('movedProject', () => {
  it('moves a project, and answers null for an unknown root or a move that goes nowhere', () => {
    const order = ['/a', '/b', '/c'];
    expect(movedProject(order, '/c', 'top')).toEqual(['/c', '/a', '/b']);
    expect(movedProject(order, '/a', 'down')).toEqual(['/b', '/a', '/c']);
    expect(movedProject(order, '/x', 'top')).toBeNull();
    expect(movedProject(order, '/a', 'up')).toBeNull();
    expect(order).toEqual(['/a', '/b', '/c']);
  });
});

describe('createdGroup', () => {
  it('puts a new group at the top, holding the session given, and creates nothing for a blank name', () => {
    const given = state();
    const next = createdGroup(given, 'new', '  Fresh  ', '/a', 's3');
    expect(next.groups[0]).toEqual({ id: 'new', name: 'Fresh', repoRoot: '/a' });
    expect(next.groupOf).toEqual({ s1: 'a1', s2: 'a2', s3: 'new' });
    expect(createdGroup(given, 'new', '  ', '/a')).toBe(given);
    expect(given).toEqual(state());
  });
});

describe('renamedGroup', () => {
  it('renames a group, trimmed, and ignores a blank name', () => {
    const given = state();
    expect(renamedGroup(given, 'b1', ' Bee ').groups[1]).toEqual({ id: 'b1', name: 'Bee', repoRoot: '/b' });
    expect(renamedGroup(given, 'b1', ' ')).toBe(given);
    expect(given).toEqual(state());
  });
});

describe('withoutGroup', () => {
  it('drops the group and frees its members, and nobody else\'s', () => {
    const given = state();
    expect(withoutGroup(given, 'a1')).toEqual({ groups: [given.groups[1], given.groups[2]], groupOf: { s2: 'a2' } });
    expect(given).toEqual(state());
  });
});

describe('movedGroup', () => {
  it('moves a group among its own project\'s, leaving another project\'s where it sits in the registry', () => {
    const given = state();
    expect(movedGroup(given, 'a2', 'top').groups.map((g) => g.id)).toEqual(['a2', 'b1', 'a1']);
    expect(movedGroup(given, 'b1', 'up')).toBe(given);
    expect(given).toEqual(state());
  });
});

describe('withSessionInGroup', () => {
  it('moves a session into a group or out of every group, and ignores a group that is not there', () => {
    const given = state();
    expect(withSessionInGroup(given, 's1', 'b1').groupOf).toEqual({ s1: 'b1', s2: 'a2' });
    expect(withSessionInGroup(given, 's1', null).groupOf).toEqual({ s2: 'a2' });
    expect(withSessionInGroup(given, 's1', 'gone')).toBe(given);
    expect(given).toEqual(state());
  });
});
