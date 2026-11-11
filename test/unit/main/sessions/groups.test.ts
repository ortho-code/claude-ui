import { describe, it, expect, vi } from 'vitest';
import { auditLines, useMetaDir, writeMetaFile } from './meta-fixture';

vi.mock('electron', async () => (await import('./meta-fixture')).electronStub);

import { createGroup, deleteGroup, getGroupState, getProjectNames, getProjectOrder, moveGroup, moveProject, moveSessionsToGroup, renameGroup, seedProjectOrder, setProjectName } from '../../../../src/main/sessions/groups';
import { getPinned, purgeSession } from '../../../../src/main/sessions/meta';

useMetaDir();

describe('project names', () => {
  it('sets a name in place of the folder name, and a blank one clears it', async () => {
    expect(await getProjectNames()).toEqual({});
    expect(await setProjectName('/p', 'Mine')).toEqual({ '/p': 'Mine' });
    expect(await getProjectNames()).toEqual({ '/p': 'Mine' });
    expect(await setProjectName('/p', '  ')).toEqual({});
    expect(await getProjectNames()).toEqual({});
  });
});

describe('session groups', () => {
  it('prepends a new group so it lands at the top of its project', async () => {
    expect(await getGroupState()).toEqual({ groups: [], groupOf: {} });
    await createGroup('Perf pass', '/repo');
    const { groups } = await createGroup('Custom groups', '/repo');
    expect(groups.map((g) => g.name)).toEqual(['Custom groups', 'Perf pass']);
    expect(groups.every((g) => g.repoRoot === '/repo')).toBe(true);
  });

  it('creates and moves a session in one step (the row menu\'s "New group…")', async () => {
    const { groups, groupOf } = await createGroup('Perf pass', '/repo', 's1');
    expect(groupOf).toEqual({ s1: groups[0].id });
  });

  it('ignores a blank name on create and on rename', async () => {
    expect((await createGroup('   ', '/repo')).groups).toEqual([]);
    const { groups } = await createGroup('Perf pass', '/repo');
    const renamed = await renameGroup(groups[0].id, '  ');
    expect(renamed.groups[0].name).toBe('Perf pass');
    expect((await renameGroup(groups[0].id, ' Perf ')).groups[0].name).toBe('Perf');
  });

  it('moves a session between groups rather than adding it to both', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    const b = (await createGroup('B', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    const { groupOf } = await moveSessionsToGroup(['s1'], b.id);
    expect(groupOf).toEqual({ s1: b.id });
  });

  it('moves several sessions in one write, from whichever groups they were in', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    const b = (await createGroup('B', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    const before = await auditLines();
    expect((await moveSessionsToGroup(['s1', 's2'], b.id)).groupOf).toEqual({ s1: b.id, s2: b.id });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['moveSessionsToGroup']);
  });

  it('takes a session out of every group with a null target, and ignores an unknown group', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    expect((await moveSessionsToGroup(['s1'], null)).groupOf).toEqual({});
    expect((await moveSessionsToGroup(['s1'], 'no-such-group')).groupOf).toEqual({});
  });

  it('deletes a group, ungrouping its members and leaving other groups alone', async () => {
    const doomed = (await createGroup('Doomed', '/repo')).groups[0];
    const keeper = (await createGroup('Keeper', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], doomed.id);
    await moveSessionsToGroup(['s2'], keeper.id);
    const { groups, groupOf } = await deleteGroup(doomed.id);
    expect(groups.map((g) => g.name)).toEqual(['Keeper']);
    expect(groupOf).toEqual({ s2: keeper.id }); // s1 is ungrouped, not deleted
  });

  it('drops a deleted session\'s membership', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    await purgeSession('s1');
    expect((await getGroupState()).groupOf).toEqual({});
  });

  it('defaults the fields for a meta.json written before groups existed', async () => {
    await writeMetaFile({ pinned: ['p1'], version: 3 });
    expect(await getGroupState()).toEqual({ groups: [], groupOf: {} });
    expect(await getPinned()).toEqual(['p1']);
  });

  it('drops malformed groups and memberships pointing at a group that is gone', async () => {
    await writeMetaFile({
      groups: [{ id: 'g1', name: 'Real', repoRoot: '/repo' }, { id: 'g2', name: 42 }],
      groupOf: { s1: 'g1', s2: 'g2', s3: 'vanished', s4: 7 },
      version: 3,
    });
    const { groups, groupOf } = await getGroupState();
    expect(groups.map((g) => g.id)).toEqual(['g1']);
    expect(groupOf).toEqual({ s1: 'g1' });
  });
});

describe('moveGroup', () => {
  // Three in /a with one of /b wedged between them, so a move that leaked outside its own project would be visible in the result rather than passing by luck.
  async function seed(): Promise<string[]> {
    await createGroup('a3', '/a');
    await createGroup('b1', '/b');
    await createGroup('a2', '/a');
    await createGroup('a1', '/a');
    const { groups } = await getGroupState();
    expect(groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    return groups.filter((g) => g.repoRoot === '/a').map((g) => g.id);
  }

  it('moves within its own project and leaves other projects in place', async () => {
    const [, , a3] = await seed();
    const { groups } = await moveGroup(a3, 'top');
    // a3 leads /a's groups; b1 has not budged from the slot it held.
    expect(groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a3', 'a1', 'a2']);
    expect(groups.map((g) => g.name)).toEqual(['a3', 'a1', 'b1', 'a2']);
  });

  it('steps one place at a time, skipping over another project\'s group', async () => {
    const [a1] = await seed();
    const down = await moveGroup(a1, 'down');
    expect(down.groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a2', 'a1', 'a3']);
    const up = await moveGroup(a1, 'up');
    expect(up.groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sends a group to the end of its own project, not the end of the registry', async () => {
    const [a1] = await seed();
    const { groups } = await moveGroup(a1, 'bottom');
    expect(groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a2', 'a3', 'a1']);
    expect(groups.map((g) => g.name)).toEqual(['a2', 'a3', 'b1', 'a1']);
  });

  it('ignores a move that would fall off either end, and an unknown id', async () => {
    const [a1, , a3] = await seed();
    expect((await moveGroup(a1, 'up')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    expect((await moveGroup(a3, 'down')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    expect((await moveGroup('nope', 'top')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('survives a reload, so the order is really persisted', async () => {
    const [, , a3] = await seed();
    await moveGroup(a3, 'top');
    expect((await getGroupState()).groups.map((g) => g.name)).toEqual(['a3', 'a1', 'b1', 'a2']);
  });
});

describe('projectOrder', () => {
  it('seeds from the order given, so the first run changes nothing on screen', async () => {
    expect(await getProjectOrder()).toEqual([]);
    expect(await seedProjectOrder(['/c', '/a', '/b'])).toEqual(['/c', '/a', '/b']);
    expect(await getProjectOrder()).toEqual(['/c', '/a', '/b']);
  });

  it('puts a project first seen later at the front, keeping the rest put', async () => {
    await seedProjectOrder(['/a', '/b']);
    expect(await seedProjectOrder(['/a', '/b', '/new'])).toEqual(['/new', '/a', '/b']);
  });

  it('keeps the slot of a project that is absent for a while', async () => {
    await seedProjectOrder(['/a', '/b', '/c']);
    // /b contributes no sessions this time (all deleted, say) and must not lose its place.
    expect(await seedProjectOrder(['/a', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(await seedProjectOrder(['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('moves a project to either end and one step at a time', async () => {
    const all = ['/a', '/b', '/c'];
    await seedProjectOrder(all);
    expect(await moveProject('/c', 'top', all)).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'down', all)).toEqual(['/a', '/c', '/b']);
    expect(await moveProject('/c', 'up', all)).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'bottom', all)).toEqual(['/a', '/b', '/c']);
  });

  it('moves among the projects shown, stepping over the rest', async () => {
    await seedProjectOrder(['/a', '/gone', '/b']);
    expect(await moveProject('/a', 'down', ['/a', '/b'])).toEqual(['/gone', '/b', '/a']);
  });

  it('ignores a move off either end and an unseen project', async () => {
    const all = ['/a', '/b'];
    await seedProjectOrder(all);
    expect(await moveProject('/a', 'up', all)).toEqual(['/a', '/b']);
    expect(await moveProject('/b', 'down', all)).toEqual(['/a', '/b']);
    expect(await moveProject('/nope', 'top', all)).toEqual(['/a', '/b']);
  });

  it('survives a reload', async () => {
    await seedProjectOrder(['/a', '/b']);
    await moveProject('/b', 'top', ['/a', '/b']);
    expect(await getProjectOrder()).toEqual(['/b', '/a']);
  });
});
