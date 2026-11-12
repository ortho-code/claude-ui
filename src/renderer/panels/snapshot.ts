import { categoryOf } from '../../shared/status/needs-you';
import { prKey } from '../../shared/sessions/prs';
import type { ClosedHow, SetAside, NeedsYou, PrAuthor, PrDates, PrNames, PrRole, PrStatus } from '../../shared/types';
import { sessionLabel } from '../rules/sessions';
import { asksForYou } from '../status/rollup';
import { store, type AppState, type View } from '../state/app';
import { sessionNudge, sessionRunning, switcherPool, tabWith } from '../state/views';

/**
 * THE SESSIONS SNAPSHOT: the sessions the app has, as a list panel's script is given them in a file of its run's own (`CLAUDE_UI_SESSIONS`), so it can choose its rows from them; the live values keep the rows it chose current between runs.
 * Data and not words: what a reason or a status is called is the type's to say, since the app's own wording is its tooltips' (decided 2026-11-02).
 * Built per run from the store, which alone holds every part of it together, and compared whole by a panel that watches sessions (`PanelRuns`), so a field that changes on every message, such as when the session was last active, stays out until a type asks for it.
 * Its shape is the one the `page` kind's API would serve, so it is not thrown away when that comes.
 */

/** A session's status as the snapshot gives it: what its claude last reported; a session claude-ui did not start reports nothing, and is null rather than guessed. */
export type SnapshotStatus = 'busy' | 'ready' | 'background' | 'waiting' | 'closed';

const STATUSES: ReadonlySet<string> = new Set<SnapshotStatus>(['busy', 'ready', 'background', 'waiting', 'closed']);

/**
 * One reason a session needs you, as the file gives it: its type, the category that type belongs to, null for a type the app has no category for, and when it was marked; a PR's change names its PR, `owner/name#number`, and a session that was running when the app closed how it closed.
 * Claude asking or ready is not here: `status` and `read` say it.
 */
export interface SnapshotReason {
  type: NeedsYou['type'];
  category: string | null;
  at: number;
  pr?: string;
  how?: ClosedHow;
}

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
  /** It asks for you now, by the rule its dot and the switcher's count follow (`asksForYou`, `sessionNudge`). */
  asks: boolean;
  /** A tab holds it with its claude running, whatever claude last reported (`sessionRunning`). */
  running: boolean;
  /** Why it is marked as needing you, every reason; empty when it is not. */
  needsYou: readonly SnapshotReason[];
  /** Until when it is set aside, null for whenever; null when it is not set aside. */
  setAside: SetAside | null;
  prs: SnapshotPr[];
}

/** A PR a session links, as the file gives it: its title and author as GitHub last gave them, null before it has, and what GitHub last said of it. */
export interface SnapshotPr {
  repository: string;
  number: number;
  url: string;
  title: string | null;
  author: PrAuthor | null;
  status: SnapshotPrStatus | null;
}

/** Every field of a session in the file, each once: a record, so a field added to `SnapshotSession` cannot be left out of the list docs/panel-types.md is held to. */
const FIELDS: Record<keyof SnapshotSession, true> = { id: true, title: true, project: true, group: true, status: true, read: true, asks: true, running: true, needsYou: true, setAside: true, prs: true };
export const SNAPSHOT_FIELDS = Object.keys(FIELDS);

/**
 * What GitHub says of a PR, as the file gives it: the status without what only the app's own comparison reads, the ids of the reviews asking for changes, and without its names, which the PR itself carries (`SnapshotPr`).
 * When it was opened, and for a merged or closed one when it settled, each null where GitHub has not said.
 */
export type SnapshotPrStatus = ({ state: 'merged' | 'closed'; role: PrRole | null; settledAt: string | null } | Omit<Extract<PrStatus, { state: 'open' }>, 'changesRequested' | keyof PrNames | keyof PrDates>) & {
  openedAt: string | null;
};

function snapshotPrStatus(status: PrStatus): SnapshotPrStatus {
  const openedAt = status.openedAt ?? null;
  if (status.state !== 'open') return { state: status.state, role: status.role, openedAt, settledAt: status.settledAt ?? null };
  const { state, role, draft, review, checks, conflict, approvals, newCommits, reviewAsked } = status;
  return { state, role, draft, review, checks, conflict, approvals, newCommits, reviewAsked, openedAt };
}

export interface SessionsSnapshot {
  version: 1;
  sessions: SnapshotSession[];
}

/** The slices the snapshot is made of: what a panel that watches sessions is told about. */
export const SNAPSHOT_SLICES = ['sessions', 'tabs', 'finished', 'pendingDeletes', 'statuses', 'acked', 'needsYou', 'needsYouTypes', 'setAside', 'groupState', 'prStatus', 'prNames', 'settings'] as const satisfies readonly (keyof AppState)[];

/** Every session not finished, as the switcher counts them, each once, by id, so the same sessions in a new order are the same snapshot. */
function sessionsSnapshot(view: View<(typeof SNAPSHOT_SLICES)[number]> = store.get()): SessionsSnapshot {
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
        asks: asksForYou(sessionNudge(id, view)),
        running: sessionRunning(id, view),
        needsYou: (view.needsYou.get(id) ?? []).map((reason) => ({ ...reason, category: categoryOf(view.needsYouTypes, reason.type) })),
        setAside: view.setAside.get(id) ?? null,
        prs: session.prs.map((pr) => {
          const status = view.prStatus.statuses[prKey(pr)];
          const names = view.prNames.get(prKey(pr));
          return { repository: pr.repository, number: pr.number, url: pr.url, title: names?.title ?? null, author: names?.author ?? null, status: status === undefined ? null : snapshotPrStatus(status) };
        }),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { version: 1, sessions };
}

/** The snapshot as its file holds it. */
export function snapshotText(): string {
  return JSON.stringify(sessionsSnapshot());
}
