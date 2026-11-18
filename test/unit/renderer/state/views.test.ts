import { describe, expect, it } from 'vitest';
import type { TabState } from '../../../../src/renderer/state/app';
import { finishedOnlyProjects, visibleSessions } from '../../../../src/renderer/state/views';
import { session } from '../fixtures';

const listed = session({ id: 'listed', repoRoot: '/p/one' });
const done = session({ id: 'done', repoRoot: '/p/two' });
// A session a tab started that has no transcript yet, so the listing does not hold it.
const unwritten = session({ id: 'unwritten', repoRoot: '/p/one' });
const tabOf = (s: typeof listed): TabState => ({ token: `t-${s.id}`, session: s }) as TabState;

describe('visibleSessions', () => {
  it('holds every listed session, and before them a tab’s session not listed yet', () => {
    const tabs = [tabOf(listed), tabOf(unwritten)];
    expect(visibleSessions({ sessions: [listed, done], tabs }).map((s) => s.id)).toEqual(['unwritten', 'listed', 'done']);
  });

  it('answers again from the same listing and tabs, and works it out anew for others', () => {
    const sessions = [listed, done];
    const tabs = [tabOf(listed)];
    const first = visibleSessions({ sessions, tabs });
    expect(visibleSessions({ sessions, tabs })).toBe(first);
    expect(visibleSessions({ sessions, tabs: [tabOf(unwritten)] }).map((s) => s.id)).toEqual(['unwritten', 'listed', 'done']);
    expect(visibleSessions({ sessions: [listed], tabs }).map((s) => s.id)).toEqual(['listed']);
  });
});

describe('finishedOnlyProjects', () => {
  const view = (finished: string[], pendingDeletes: string[] = []) => ({ sessions: [listed, done], tabs: [], finished: new Map(finished.map((id) => [id, 1])), pendingDeletes: new Set(pendingDeletes) });

  it('lists a project whose sessions are all finished, with those sessions, and no other', () => {
    expect([...finishedOnlyProjects(view(['done']))]).toEqual([['/p/two', [done]]]);
  });

  it('answers again from the same slices, and works it out anew when one changes', () => {
    const same = view(['done']);
    const first = finishedOnlyProjects(same);
    expect(finishedOnlyProjects(same)).toBe(first);
    // Each right after `same`, so each differs from the last call in its one slice only.
    expect([...finishedOnlyProjects({ ...same, pendingDeletes: new Set(['done']) })]).toEqual([]);
    expect([...finishedOnlyProjects({ ...same, finished: new Map([['listed', 1]]) })]).toEqual([['/p/one', [listed]]]);
  });
});
