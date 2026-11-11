import type { GroupState, NeedsYou, SessionGroup, SessionSummary } from '../../shared/types';
import { rollUp, type NudgeStatus } from '../status/rollup';
import { DEFAULT_RANKING, type Strength } from '../status/shown';
import { entityKey, projectRootExists } from './sessions';

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

/** A project as the switcher and the session list draw it: the sessions shown under it, and when there are none because every one is finished, those. */
interface ProjectEntry {
  shown: SessionSummary[];
  finished: SessionSummary[];
}

/**
 * The projects to draw, in the order you set: one per root among `sessions`, and one, with nothing shown, per root in `finishedOnly` (`finishedOnlyProjects`).
 * The ONE place the switcher and the session list take their projects from, so the two never disagree about which projects there are or where each sits.
 */
export function projectEntries(sessions: SessionSummary[], finishedOnly: ReadonlyMap<string, SessionSummary[]>, projectOrder: readonly string[]): [string, ProjectEntry][] {
  const entries: [string, ProjectEntry][] = groupByRepo(sessions).map(([repoRoot, shown]) => [repoRoot, { shown, finished: [] }]);
  for (const [repoRoot, finished] of finishedOnly) entries.push([repoRoot, { shown: [], finished }]);
  return orderProjects(entries, projectOrder);
}

/** The sessions that answer for a project's folder: those shown, or its finished ones when none is, which sit in the same folder. */
export const folderWitnesses = ({ shown, finished }: ProjectEntry): SessionSummary[] => (shown.length > 0 ? shown : finished);

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
