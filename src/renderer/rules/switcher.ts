import type { NeedsYou, SessionSummary } from '../../shared/types';
import { rollUp, strongestNudge, type RollUp } from '../status/rollup';
import { DEFAULT_RANKING, type Strength } from '../status/shown';
import { folderWitnesses, projectEntries } from './session-list';
import { displayName, projectRootExists } from './sessions';

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
