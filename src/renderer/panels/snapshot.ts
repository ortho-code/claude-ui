import { prReference } from '../../shared/prs';
import type { Later, NeedsYou, PrStatus } from '../../shared/types';
import { sessionLabel } from '../logic';
import { store, type AppState, type View } from '../state/app';
import { switcherPool, tabWith } from '../state/views';

/**
 * THE SESSIONS SNAPSHOT: the sessions the app has, as a list panel's script is given them in a file of its run's own (`CLAUDE_UI_SESSIONS`), so it can choose its rows from them; the live values keep the rows it chose current between runs.
 * Data and not words: what a reason or a status is called is the type's to say, since the app's own wording is its tooltips' (decided 2026-11-02).
 * Built per run from the store, which alone holds every part of it together, and compared whole by a panel that watches sessions (`PanelRuns`), so a field that changes on every message, such as when the session was last active, stays out until a type asks for it.
 * Its shape is the one the `page` kind's API would serve, so it is not thrown away when that comes.
 */

/** A session's status as the snapshot gives it: what its claude last reported; a session claude-ui did not start reports nothing, and is null rather than guessed. */
export type SnapshotStatus = 'busy' | 'idle' | 'background' | 'waiting' | 'closed';

const STATUSES: ReadonlySet<string> = new Set<SnapshotStatus>(['busy', 'idle', 'background', 'waiting', 'closed']);

export interface SnapshotSession {
  id: string;
  /** What the app calls it everywhere, as a live value's `title` says it. */
  title: string;
  /** Its project, by repo root. */
  project: string;
  group: { id: string; name: string } | null;
  status: SnapshotStatus | null;
  /** Its dot was marked read. */
  read: boolean;
  /** Why it is marked as needing you, every reason; empty when it is not. */
  needsYou: readonly NeedsYou[];
  later: Later | null;
  prs: { repository: string; number: number; url: string; status: PrStatus | null }[];
}

export interface SessionsSnapshot {
  version: 1;
  sessions: SnapshotSession[];
}

/** The slices the snapshot is made of: what a panel that watches sessions is told about. */
export const SNAPSHOT_SLICES = ['sessions', 'tabs', 'archived', 'pendingDeletes', 'statuses', 'acked', 'needsYou', 'later', 'groupState', 'prStatus'] as const satisfies readonly (keyof AppState)[];

/** Every session not archived, as the switcher counts them, each once, by id, so the same sessions in a new order are the same snapshot. */
export function sessionsSnapshot(view: View<(typeof SNAPSHOT_SLICES)[number]> = store.get()): SessionsSnapshot {
  const groups = new Map(view.groupState.groups.map((group) => [group.id, group]));
  // Two tabs can hold one session the listing does not have yet, and the pool has it once for each.
  const pool = [...new Map(switcherPool(view).map((session) => [session.id, session])).values()];
  const sessions = pool
    .map((listed): SnapshotSession => {
      const { id } = listed;
      // A tab holds the newer copy, as a live value reads it.
      const session = tabWith(id, view)?.session ?? listed;
      const group = groups.get(view.groupState.groupOf[id] ?? '');
      const status = view.statuses.get(id);
      return {
        id,
        title: sessionLabel(session),
        project: session.repoRoot,
        group: group ? { id: group.id, name: group.name } : null,
        status: status !== undefined && STATUSES.has(status) ? (status as SnapshotStatus) : null,
        read: view.acked.has(id),
        needsYou: view.needsYou.get(id) ?? [],
        later: view.later.get(id) ?? null,
        prs: session.prs.map((pr) => ({ repository: pr.repository, number: pr.number, url: pr.url, status: view.prStatus.statuses[prReference(pr)] ?? null })),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: 1, sessions };
}

/** The snapshot as its file holds it. */
export function snapshotText(): string {
  return JSON.stringify(sessionsSnapshot());
}
