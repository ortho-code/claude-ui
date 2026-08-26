// Pure sidebar logic, kept free of DOM/globals so it can be unit-tested. renderer.ts wires these
// to its state and the DOM.
import type { GroupState, SessionGroup, SessionSummary } from '../shared/types';

// The stable key for a displayed session entity: the session's own id, always. It is immutable, so
// pins/archives/tabs can never go stale — a conversation-derived key stopped matching its session
// the moment the session gained a sibling. conversationId remains the SIGNAL that groups a family
// (isSibling/siblingIds, derived in the main process) but no longer names anything.
export function entityKey(s: SessionSummary): string {
  return s.id;
}

// One entry per entity key. Keys are unique per session file today, so this is a plain index; the
// latest-activity preference only matters if the same id ever appears twice in a listing.
export function sessionsByKey(sessions: SessionSummary[]): Map<string, SessionSummary> {
  const byKey = new Map<string, SessionSummary>();
  for (const s of sessions) {
    const key = entityKey(s);
    const prev = byKey.get(key);
    if (!prev || s.lastActivity > prev.lastActivity) byKey.set(key, s);
  }
  return byKey;
}

// The list's structure: one line per session for the fields that affect what the sidebar shows.
// Excludes lastActivity so a running session writing its transcript isn't a "change".
export function structuralSignature(sessions: SessionSummary[]): string {
  return sessions
    .map((s) => `${s.conversationId}\0${s.id}\0${s.cwd}\0${s.title}\0${s.firstMessage}`)
    .sort()
    .join('\n');
}

// Group by repo root so a repo's worktrees (and subdirectories) file under one heading.
export function groupByRepo(sessions: SessionSummary[]): [string, SessionSummary[]][] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = groups.get(session.repoRoot) ?? [];
    list.push(session);
    groups.set(session.repoRoot, list);
  }
  return [...groups.entries()];
}

// Put grouped projects into the user's explicit order. A root with no slot yet keeps its incoming
// (recency) position at the END rather than the front: it is about to be seeded, and guessing a
// placement here would make it jump once the real order arrives.
export function orderProjects<T>(entries: [string, T][], order: readonly string[]): [string, T][] {
  const slot = new Map(order.map((root, i) => [root, i]));
  return entries
    .map((entry, i) => ({ entry, i, at: slot.get(entry[0]) }))
    .sort((a, b) => {
      if (a.at === undefined && b.at === undefined) return a.i - b.i;
      if (a.at === undefined) return 1;
      if (b.at === undefined) return -1;
      return a.at - b.at;
    })
    .map((x) => x.entry);
}

// A project's own name on disk: the last path segment of its repo root.
export function folderName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
}

// A project's display name: the user's rename override if set, else the folder name. Used everywhere a
// project is labelled (project headings, tab bar, switcher); the full path stays available on hover.
export function displayName(repoRoot: string, names?: ReadonlyMap<string, string>): string {
  return names?.get(repoRoot) || folderName(repoRoot);
}

// Short, human label for a model id, parsed generically (no hardcoded model list): the alphabetic
// segment is the family, the numeric segments (minus the trailing YYYYMMDD date, either id order)
// are the version. So new models need no code change. Examples: claude-opus-4-8 -> "Opus 4.8",
// claude-fable-5 -> "Fable 5", claude-3-5-haiku-20241022 -> "Haiku 3.5". Falls back to the raw id
// only when there's no family word at all; empty in -> empty out.
export function modelLabel(model: string): string {
  if (!model) return '';
  const segs = model.toLowerCase().split('-').filter((s) => s && s !== 'claude');
  const family = segs.filter((s) => /^[a-z]+$/.test(s)).join(' ');
  if (!family) return model;
  const version = segs.filter((s) => /^\d+$/.test(s) && s.length !== 8).join('.');
  const name = family.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return version ? `${name} ${version}` : name;
}

// Move `moved` to `targetIndex` within the subsequence of items sharing its group key, leaving items
// of other groups in their slots. Pure; used to reorder a tab within its own project.
export function reorderWithinGroup<T>(items: T[], keyOf: (t: T) => string, moved: T, targetIndex: number): T[] {
  const key = keyOf(moved);
  const group = items.filter((t) => keyOf(t) === key);
  const from = group.indexOf(moved);
  if (from === -1) return items.slice();
  group.splice(from, 1);
  group.splice(Math.max(0, Math.min(targetIndex, group.length)), 0, moved);
  let i = 0;
  return items.map((t) => (keyOf(t) === key ? group[i++] : t));
}

// A short "x min ago" relative time. `now` is injectable for tests.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// The [from, to] window for a date preset, rolling from `now`. 'any' and 'custom' have no preset
// bounds ('custom' is read from the date inputs by the caller).
export function datePresetRange(preset: string, now: number): { from: number | null; to: number | null } {
  const day = 86_400_000;
  if (preset === 'today') {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return { from: start.getTime(), to: null };
  }
  if (preset === '7d') return { from: now - 7 * day, to: null };
  if (preset === '30d') return { from: now - 30 * day, to: null };
  return { from: null, to: null };
}

export interface FilterCriteria {
  /** Case-insensitive text; empty means no text filter. */
  text: string;
  pinnedOnly: boolean;
  worktreeOnly: boolean;
  /** Show only members of a multi-session family (siblings). */
  siblingOnly: boolean;
  archivedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  pinned: ReadonlySet<string>;
  /** Set or Map keyed by conversationId; only membership is used. */
  archived: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
  /** Session id -> note, so typed text matches a note as well as a title. */
  notes?: ReadonlyMap<string, string>;
  /** Session key -> its group's name, so typing a group name surfaces everything in it. */
  groupNames?: ReadonlyMap<string, string>;
}

// Whether a session survives every active filter. Archived sessions are hidden from the normal
// list and are the only ones shown in the archived view; the toggle flips which set is visible.
export function sessionPasses(session: SessionSummary, c: FilterCriteria): boolean {
  const key = entityKey(session);
  if (c.pendingDeletes.has(key)) return false;
  if (c.archivedOnly !== c.archived.has(key)) return false;
  if (c.pinnedOnly && !c.pinned.has(key)) return false;
  if (c.worktreeOnly && !session.worktree) return false;
  if (c.siblingOnly && !session.isSibling) return false;
  if (c.dateFrom !== null || c.dateTo !== null) {
    const activity = new Date(session.lastActivity).getTime();
    if (c.dateFrom !== null && activity < c.dateFrom) return false;
    if (c.dateTo !== null && activity > c.dateTo) return false;
  }
  if (!c.text) return true;
  const note = c.notes?.get(key) ?? '';
  // The group name matches every session in that group, which is what makes typing one a way to
  // reach it — the group headings themselves are not searchable, only the rows under them.
  const group = c.groupNames?.get(key) ?? '';
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id} ${note} ${group}`
    .toLowerCase()
    .includes(c.text.toLowerCase());
}

// A project's rolled-up nudge for the switcher: the strongest UNATTENDED status among its sessions,
// so a project you're not looking at still shows it needs you. Priority waiting > idle > busy; null
// when nothing needs surfacing. An acked (read) session is muted and contributes nothing.
export type NudgeStatus = 'waiting' | 'idle' | 'busy' | null;

export interface SwitcherProject {
  repoRoot: string;
  name: string;
  count: number;
  badge: NudgeStatus;
}

export interface SwitcherModel {
  all: { count: number; badge: NudgeStatus };
  projects: SwitcherProject[];
}

function rollUpNudge(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
): NudgeStatus {
  let waiting = false;
  let idle = false;
  let busy = false;
  for (const s of sessions) {
    if (acked.has(s.id)) continue; // read/muted — contributes nothing
    switch (statuses.get(s.id)) {
      case 'waiting':
        waiting = true;
        break;
      case 'idle':
        idle = true;
        break;
      case 'busy':
        busy = true;
        break;
    }
  }
  return waiting ? 'waiting' : idle ? 'idle' : busy ? 'busy' : null;
}

// Build the project-switcher model from the VISIBLE tips (one per conversation, already filtered to
// what the sidebar shows). Projects order by recency: the input is recency-sorted, so a project takes
// the position of its most-recent session (first appearance). Per project: session count + the
// rolled-up nudge badge; plus an "All" aggregate over everything passed.
export function projectsForSwitcher(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  names?: ReadonlyMap<string, string>,
  projectOrder: readonly string[] = [],
): SwitcherModel {
  // Same order as the sidebar sections: the switcher is the compact view of the same list, so the
  // two must never disagree about where a project sits.
  const projects = orderProjects(groupByRepo(sessions), projectOrder).map(([repoRoot, list]) => ({
    repoRoot,
    name: displayName(repoRoot, names),
    count: list.length,
    badge: rollUpNudge(list, statuses, acked),
  }));
  return {
    all: { count: sessions.length, badge: rollUpNudge(sessions, statuses, acked) },
    projects,
  };
}

// --- The session list's shape --------------------------------------------------------------------
// One project section per repo, each holding its groups (in registry order) and then the sessions
// that are in no group. Pure: renderer.ts turns this into DOM, and every ordering rule lives here so
// it can be tested without a browser.

export interface GroupedSessions {
  group: SessionGroup;
  sessions: SessionSummary[];
}

export interface ProjectTree {
  repoRoot: string;
  /** The project's groups in registry order, each with its members. Empty ones are kept. */
  groups: GroupedSessions[];
  /** Sessions in no group. They render directly under the project heading, at full width. */
  loose: SessionSummary[];
  /** Sessions shown under this project, grouped and loose together (the heading's count). */
  count: number;
  /** Whether any session here is in a git repo (gates the worktree option on the "+"). */
  isRepo: boolean;
}

// Pinned sessions rise to the front, everything else keeps the order it came in (callers pass a
// recency-sorted list). A stable partition, so this floats a pin inside whichever section it lands
// in rather than lifting it out of its group.
function pinnedFirst(sessions: SessionSummary[], pinned: ReadonlySet<string>): SessionSummary[] {
  return [
    ...sessions.filter((s) => pinned.has(entityKey(s))),
    ...sessions.filter((s) => !pinned.has(entityKey(s))),
  ];
}

/**
 * Arrange the visible sessions into project sections. Projects keep the order they appear in
 * `sessions` (recency, since the caller sorts that way); inside a project the groups come first in
 * registry order, then the ungrouped remainder.
 *
 * `hideEmptyGroups` is for filtering: a group whose sessions were all filtered out is noise in a
 * search, but an empty group must stay visible normally — that is how a freshly created one is seen.
 */
export function buildProjectTree(
  sessions: SessionSummary[],
  state: GroupState,
  pinned: ReadonlySet<string>,
  hideEmptyGroups = false,
  projectOrder: readonly string[] = [],
): ProjectTree[] {
  const groupsByProject = new Map<string, SessionGroup[]>();
  for (const group of state.groups) {
    // repoRoot null is reserved for a future cross-project group; nothing renders it yet.
    if (group.repoRoot === null) continue;
    const list = groupsByProject.get(group.repoRoot) ?? [];
    list.push(group);
    groupsByProject.set(group.repoRoot, list);
  }

  return orderProjects(groupByRepo(sessions), projectOrder).map(([repoRoot, list]) => {
    const ordered = pinnedFirst(list, pinned);
    const projectGroups = groupsByProject.get(repoRoot) ?? [];
    const ids = new Set(projectGroups.map((g) => g.id));
    const groups = projectGroups
      .map((group) => ({ group, sessions: ordered.filter((s) => state.groupOf[entityKey(s)] === group.id) }))
      .filter((g) => !hideEmptyGroups || g.sessions.length > 0);
    // A session whose group belongs to ANOTHER project (it moved cwd, say) is loose here rather than
    // invisible: a row must always show up under the project it actually belongs to.
    const loose = ordered.filter((s) => !ids.has(state.groupOf[entityKey(s)] ?? ''));
    return { repoRoot, groups, loose, count: ordered.length, isRepo: ordered.some((s) => s.isRepo) };
  });
}

// --- Jumping to a group ---------------------------------------------------------------------------

export interface GroupJumpTarget {
  /** null is the ungrouped remainder, which has no heading of its own to jump to. */
  groupId: string | null;
  name: string;
  count: number;
  badge: NudgeStatus;
}

/**
 * The places you can jump to inside one project: its groups in list order, then "Ungrouped" when
 * loose sessions exist. Each carries what the menu shows — a name, a count, and the same rolled-up
 * nudge the switcher puts on a project, so the menu answers "which group needs me" as well as
 * "where is it".
 *
 * Empty groups are kept: an empty group still has a heading in the list, so it is still somewhere
 * you can go. The 2+ rule that decides whether the trigger appears at all is the caller's, so this
 * stays a plain description of the project.
 */
export function groupJumpTargets(
  project: ProjectTree,
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
): GroupJumpTarget[] {
  const targets: GroupJumpTarget[] = project.groups.map(({ group, sessions }) => ({
    groupId: group.id,
    name: group.name,
    count: sessions.length,
    badge: rollUpNudge(sessions, statuses, acked),
  }));
  if (project.loose.length > 0) {
    targets.push({
      groupId: null,
      name: 'Ungrouped',
      count: project.loose.length,
      badge: rollUpNudge(project.loose, statuses, acked),
    });
  }
  return targets;
}
