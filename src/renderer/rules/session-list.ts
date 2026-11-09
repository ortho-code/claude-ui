import { prReference } from '../../shared/sessions/prs';
import type { GroupState, NeedsYou, SessionGroup, SessionSummary } from '../../shared/types';
import { rollUp, strongestNudge, type NudgeStatus, type RollUp } from '../status/rollup';
import { DEFAULT_RANKING, type Strength } from '../status/shown';
import { displayName, entityKey, projectRootExists, unstartableReason, worktreeMarkState } from './sessions';

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

// Put grouped projects into the user's explicit order.
// A root with no slot yet keeps its incoming (recency) position at the END rather than the front: it is about to be seeded, and guessing a placement here would make it jump once the real order arrives.
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

// The [from, to] window for a date preset, rolling from `now`.
// 'any' and 'custom' have no preset bounds ('custom' is read from the date inputs by the caller).
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
  /** Show only sessions with a tab — running or cold. */
  openOnly: boolean;
  /**
   * Show only LIVE sessions — a claude process behind them.
   * Narrower than openOnly, which counts a cold tab too.
   */
  liveOnly: boolean;
  /** Show only sessions set aside, with a tab or without. */
  setAsideOnly: boolean;
  worktreeOnly: boolean;
  /** Show only sessions that cannot run because their folder is gone — the set worth finding to clean up, or to put a folder back for. */
  goneOnly: boolean;
  /** Show only members of a multi-session family (siblings). */
  siblingOnly: boolean;
  /** Show only sessions whose transcript links a PR. */
  prsOnly: boolean;
  finishedOnly: boolean;
  /**
   * Show only sessions carrying a note.
   * Reads `notes`, where an entry exists only when there IS one (a blank note deletes it).
   */
  notedOnly: boolean;
  dateFrom: number | null;
  dateTo: number | null;
  pinned: ReadonlySet<string>;
  /** Keys of the sessions with a tab; only consulted when openOnly is set. */
  open?: ReadonlySet<string>;
  /** Keys of the live sessions; only consulted when liveOnly is set. */
  live?: ReadonlySet<string>;
  /** Keys of the sessions set aside; only consulted when setAsideOnly is set. */
  setAside?: { has(key: string): boolean };
  /** Set or Map keyed by conversationId; only membership is used. */
  finished: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
  /** Session id -> note, so typed text matches a note as well as a title. */
  notes?: ReadonlyMap<string, string>;
  /** Session key -> its group's name, so typing a group name surfaces everything in it. */
  groupNames?: ReadonlyMap<string, string>;
}

/**
 * Whether a session is in the set a view holds before any filter: the finished view holds the finished sessions, the normal view the rest, and a session on its way to the trash is in neither.
 * One rule for the list, the switcher's counts and the filter count's total, so the total is always the set the matches were taken from.
 */
export function inView(key: string, finishedView: boolean, finished: { has(key: string): boolean }, pendingDeletes: ReadonlySet<string>): boolean {
  return !pendingDeletes.has(key) && finished.has(key) === finishedView;
}

// Whether a session survives every active filter.
// Finished sessions are hidden from the normal list and are the only ones shown in the finished view; the toggle flips which set is visible.
export function sessionPasses(session: SessionSummary, c: FilterCriteria): boolean {
  const key = entityKey(session);
  if (!inView(key, c.finishedOnly, c.finished, c.pendingDeletes)) return false;
  if (c.pinnedOnly && !c.pinned.has(key)) return false;
  if (c.openOnly && !c.open?.has(key)) return false;
  if (c.liveOnly && !c.live?.has(key)) return false;
  if (c.setAsideOnly && !c.setAside?.has(key)) return false;
  if (c.worktreeOnly && worktreeMarkState(session) === null) return false;
  // The same question the row asks itself, through the same function — a second rule for "is this dead" would be able to disagree with the dimming.
  if (c.goneOnly && unstartableReason(session) === null) return false;
  if (c.siblingOnly && !session.isSibling) return false;
  if (c.prsOnly && session.prs.length === 0) return false;
  if (c.notedOnly && !c.notes?.has(key)) return false;
  if (c.dateFrom !== null || c.dateTo !== null) {
    const activity = new Date(session.lastActivity).getTime();
    if (c.dateFrom !== null && activity < c.dateFrom) return false;
    if (c.dateTo !== null && activity > c.dateTo) return false;
  }
  if (!c.text) return true;
  const note = c.notes?.get(key) ?? '';
  // The group name matches every session in that group, which is what makes typing one a way to reach it — the group headings themselves are not searchable, only the rows under them.
  const group = c.groupNames?.get(key) ?? '';
  // A PR by the reference its menus show, so its number finds the session that linked it.
  const prs = session.prs.map(prReference).join(' ');
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id} ${note} ${group} ${prs}`
    .toLowerCase()
    .includes(c.text.toLowerCase());
}

export interface SwitcherProject extends RollUp {
  repoRoot: string;
  name: string;
  count: number;
  /** Whether the project's folder is still there, by the same rule as the session list's headings. */
  rootExists: boolean;
}

export interface SwitcherModel {
  all: RollUp & { count: number };
  projects: SwitcherProject[];
}

/** Several roll-ups as one, as projects add up to the switcher's title. */
function rollUpOf(rollUps: readonly RollUp[], strength: Strength): RollUp {
  return {
    asking: rollUps.reduce((total, part) => total + part.asking, 0),
    working: rollUps.reduce((total, part) => total + part.working, 0),
    badge: strongestNudge(
      rollUps.map((part) => part.badge),
      strength,
    ),
  };
}

/** A project as the switcher and the session list draw it: the sessions shown under it, and when there are none because every one is finished, those. */
interface ProjectEntry {
  shown: SessionSummary[];
  finished: SessionSummary[];
}

/**
 * The projects to draw, in the order you set: one per root among `sessions`, and one, with nothing shown, per root in `finishedOnly` (`finishedOnlyProjects`).
 * The ONE place the switcher and the session list take their projects from, so the two never disagree about which projects there are or where each sits.
 */
function projectEntries(sessions: SessionSummary[], finishedOnly: ReadonlyMap<string, SessionSummary[]>, projectOrder: readonly string[]): [string, ProjectEntry][] {
  const entries: [string, ProjectEntry][] = groupByRepo(sessions).map(([repoRoot, shown]) => [repoRoot, { shown, finished: [] }]);
  for (const [repoRoot, finished] of finishedOnly) entries.push([repoRoot, { shown: [], finished }]);
  return orderProjects(entries, projectOrder);
}

/** The sessions that answer for a project's folder: those shown, or its finished ones when none is, which sit in the same folder. */
const folderWitnesses = ({ shown, finished }: ProjectEntry): SessionSummary[] => (shown.length > 0 ? shown : finished);

// Build the project-switcher model from the VISIBLE tips (one per conversation, already filtered to what the sidebar shows).
// Projects follow the order you set (`projectOrder`, `orderProjects`), as in the session list; a project with no place in it yet goes last.
// Per project: session count + the rolled-up nudge badge; plus an "All" aggregate over everything passed.
export function projectsForSwitcher(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  needsYou: ReadonlyMap<string, readonly NeedsYou[]>,
  names?: ReadonlyMap<string, string>,
  projectOrder: readonly string[] = [],
  finishedOnly: ReadonlyMap<string, SessionSummary[]> = new Map(),
  muted: ReadonlySet<string> = new Set(),
  strength: Strength = DEFAULT_RANKING,
): SwitcherModel {
  // Same order as the sidebar sections: the switcher is the compact view of the same list, so the two must never disagree about where a project sits.
  const projects = projectEntries(sessions, finishedOnly, projectOrder).map(([repoRoot, entry]) => ({
    repoRoot,
    name: displayName(repoRoot, names),
    count: entry.shown.length,
    ...rollUp(entry.shown, statuses, acked, needsYou, muted, strength),
    rootExists: projectRootExists(folderWitnesses(entry)),
  }));
  return {
    all: { count: sessions.length, ...rollUp(sessions, statuses, acked, needsYou, muted, strength) },
    projects,
  };
}

/**
 * What the switcher's title adds up: every project but the one on show, and every project in All (decided 2026-11-08).
 * The project on show is left out because its tabs and its rows already show it; All has no elsewhere, and is where a summary of everything is wanted.
 */
export function elsewhere(model: SwitcherModel, onShow: string | null, strength: Strength): RollUp {
  if (onShow === null) return model.all;
  return rollUpOf(
    model.projects.filter((project) => project.repoRoot !== onShow),
    strength,
  );
}

export interface GroupedSessions {
  group: SessionGroup;
  sessions: SessionSummary[];
}

/** One project section of the session list: its groups, in registry order, and then the sessions that are in no group. */
export interface ProjectTree {
  repoRoot: string;
  /**
   * The project's groups in registry order, each with its members.
   * Empty ones are kept.
   */
  groups: GroupedSessions[];
  /**
   * Sessions in no group.
   * They render directly under the project heading, at full width.
   */
  loose: SessionSummary[];
  /** Sessions shown under this project, grouped and loose together (the heading's count). */
  count: number;
  /** Whether the project's folder is a git repository, as any session the app knows there says, not only the ones shown (gates the worktree option). */
  isRepo: boolean;
  /**
   * Whether the project's own folder is still there.
   * False means nothing new can be started in it — the sessions remain, as history to read or clean up.
   */
  rootExists: boolean;
  /** How many sessions it has finished when every one it has is, and so none is shown: the project stays, saying so; 0 for a project with any shown. */
  finished: number;
}

// Pinned sessions rise to the front, everything else keeps the order it came in (callers pass a recency-sorted list).
// A stable partition, so this floats a pin inside whichever section it lands in rather than lifting it out of its group.
function pinnedFirst(sessions: SessionSummary[], pinned: ReadonlySet<string>): SessionSummary[] {
  return [
    ...sessions.filter((s) => pinned.has(entityKey(s))),
    ...sessions.filter((s) => !pinned.has(entityKey(s))),
  ];
}

/**
 * Arrange the visible sessions into project sections.
 * Projects follow the order you set (`projectOrder`, `orderProjects`), a project with no place in it yet going last; inside a project the groups come first in registry order, then the ungrouped remainder, each with its pinned sessions first and the rest in the order they came in (recency, since the caller sorts that way).
 *
 * `hideEmptyGroups` is for filtering: a group whose sessions were all filtered out is noise in a search, but an empty group must stay visible normally — that is how a freshly created one is seen.
 * A root in `finishedOnly` is a project with no rows, its `finished` saying how many sessions it has finished (`finishedOnlyProjects`).
 * `known` is every session the app knows, filtered out or not, which answers for what a project's folder is: a filter changes what is shown, not whether the folder is a git repository.
 */
export function buildProjectTree(
  sessions: SessionSummary[],
  state: GroupState,
  pinned: ReadonlySet<string>,
  hideEmptyGroups = false,
  projectOrder: readonly string[] = [],
  finishedOnly: ReadonlyMap<string, SessionSummary[]> = new Map(),
  known: readonly SessionSummary[] = sessions,
): ProjectTree[] {
  const groupsByProject = new Map<string, SessionGroup[]>();
  for (const group of state.groups) {
    // repoRoot null is reserved for a future cross-project group; nothing renders it yet.
    if (group.repoRoot === null) continue;
    const list = groupsByProject.get(group.repoRoot) ?? [];
    list.push(group);
    groupsByProject.set(group.repoRoot, list);
  }

  return projectEntries(sessions, finishedOnly, projectOrder).map(([repoRoot, entry]) => {
    const ordered = pinnedFirst(entry.shown, pinned);
    const projectGroups = groupsByProject.get(repoRoot) ?? [];
    const ids = new Set(projectGroups.map((g) => g.id));
    const groups = projectGroups
      .map((group) => ({ group, sessions: ordered.filter((s) => state.groupOf[entityKey(s)] === group.id) }))
      .filter((g) => !hideEmptyGroups || g.sessions.length > 0);
    // A session whose group belongs to ANOTHER project (it moved cwd, say) is loose here rather than invisible: a row must always show up under the project it actually belongs to.
    const loose = ordered.filter((s) => !ids.has(state.groupOf[entityKey(s)] ?? ''));
    return {
      repoRoot,
      groups,
      loose,
      count: ordered.length,
      isRepo: folderWitnesses(entry).some((s) => s.isRepo) || known.some((s) => s.repoRoot === repoRoot && s.isRepo),
      rootExists: projectRootExists(folderWitnesses(entry)),
      finished: entry.shown.length > 0 ? 0 : entry.finished.length,
    };
  });
}

export interface GroupJumpTarget {
  /** null is the ungrouped remainder, which has no heading of its own to jump to. */
  groupId: string | null;
  name: string;
  count: number;
  badge: NudgeStatus;
}

/**
 * The places you can jump to inside one project: its groups in list order, then "Ungrouped" when loose sessions exist.
 * Each carries what the menu shows — a name, a count, and the same rolled-up nudge the switcher puts on a project, so the menu answers "which group needs me" as well as "where is it".
 *
 * Empty groups are kept: an empty group still has a heading in the list, so it is still somewhere you can go.
 * The 2+ rule that decides whether the trigger appears at all is the caller's, so this stays a plain description of the project.
 */
export function groupJumpTargets(
  project: ProjectTree,
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  needsYou: ReadonlyMap<string, readonly NeedsYou[]>,
  muted: ReadonlySet<string> = new Set(),
  strength: Strength = DEFAULT_RANKING,
): GroupJumpTarget[] {
  const targets: GroupJumpTarget[] = project.groups.map(({ group, sessions }) => ({
    groupId: group.id,
    name: group.name,
    count: sessions.length,
    badge: rollUp(sessions, statuses, acked, needsYou, muted, strength).badge,
  }));
  if (project.loose.length > 0) {
    targets.push({
      groupId: null,
      name: 'Ungrouped',
      count: project.loose.length,
      badge: rollUp(project.loose, statuses, acked, needsYou, muted, strength).badge,
    });
  }
  return targets;
}
