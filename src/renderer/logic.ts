// Pure sidebar logic, kept free of DOM/globals so it can be unit-tested.
// renderer.ts wires these to its state and the DOM.
import { prReference } from '../shared/prs';
import type { GroupState, ScheduledTask, SessionGroup, SessionSummary } from '../shared/types';
import { splitPendingEscape, stripAnsi } from './ansi';

// The stable key for a displayed session entity: the session's own id, always.
// It is immutable, so pins/archives/tabs can never go stale — a conversation-derived key stopped matching its session the moment the session gained a sibling.
// conversationId remains the SIGNAL that groups a family (isSibling/siblingIds, derived in the main process) but no longer names anything.
export function entityKey(s: SessionSummary): string {
  return s.id;
}

// One entry per entity key.
// Keys are unique per session file today, so this is a plain index; the latest-activity preference only matters if the same id ever appears twice in a listing.
export function sessionsByKey(sessions: SessionSummary[]): Map<string, SessionSummary> {
  const byKey = new Map<string, SessionSummary>();
  for (const s of sessions) {
    const key = entityKey(s);
    const prev = byKey.get(key);
    if (!prev || s.lastActivity > prev.lastActivity) byKey.set(key, s);
  }
  return byKey;
}

/**
 * Whether each field a session carries can change what the sidebar DRAWS.
 *
 * The annotation is doing real work: `Record<keyof SessionSummary, boolean>` makes this exhaustive, so adding a field to SessionSummary fails to compile until somebody says whether the list has to redraw for it.
 * That is the point — a hand-kept list of "the fields that matter" cannot be checked, and it was wrong.
 */
const AFFECTS_ROW: Record<keyof SessionSummary, boolean> = {
  id: true,
  conversationId: true,
  cwd: true,
  repoRoot: true,
  isRepo: true,
  worktree: true,
  // Drawn as the muted worktree mark, and it can change while the app runs, when a session leaves its worktree.
  leftWorktree: true,
  // The mark's tooltip says which way it left.
  movedOutOfWorktree: true,
  title: true,
  firstMessage: true,
  // The row prints it, and switching model mid-session used to leave the old one there until something else moved.
  model: true,
  // Both shown as the sibling mark, and both can change MID-session when a fork lands.
  isSibling: true,
  siblingIds: true,
  // Drawn as the PR mark, and a running session can link one.
  prs: true,
  // Both change what the row IS — a session whose folder is gone cannot be opened, and says so — and both can flip while the app is running, with nothing in the transcript moving to announce it.
  cwdExists: true,
  repoRootExists: true,
  // Drawn as the row's time, the one field drawn that is not here: that time ages with the clock whatever the listing does, so the row asks for it every minute instead (moments.ts).
  // A running session rewrites it constantly, and a repaint for it would make the guard useless.
  lastActivity: false,
  // Main-process bookkeeping that links a fork of a compacted session into its family.
  // The renderer never reads it.
  postCompactHeads: false,
};

const SIGNATURE_FIELDS = (Object.keys(AFFECTS_ROW) as (keyof SessionSummary)[]).filter((k) => AFFECTS_ROW[k]);

/** One session's line of the signature: every field that affects a row. */
function rowLine(session: SessionSummary): string {
  return SIGNATURE_FIELDS.map((k) => fieldText(session[k])).join('\0');
}

/** A field as text for the signature: `String` reads a list of objects, such as `prs`, as `[object Object]` whatever they hold, so one swapped for another would not move it. */
function fieldText(value: SessionSummary[keyof SessionSummary]): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

/**
 * The list's structure: one line per session, over every field that affects a row.
 *
 * `refreshFromDisk` skips the whole render when this is unchanged, so anything drawn but missing here goes stale until something unrelated moves — it FREEZES a row rather than churning it, which is the harder failure to notice.
 * Getting it wrong is not hypothetical: `model` was missing, and the same gap is why a mid-session worktree move or a new sibling only appeared at the next unrelated change.
 */
export function structuralSignature(sessions: SessionSummary[]): string {
  return sessions.map(rowLine).sort().join('\n');
}

/** Whether two summaries of a session draw the same row — and so the same tab, which shows less of it. */
export function sameRow(a: SessionSummary, b: SessionSummary): boolean {
  return a === b || rowLine(a) === rowLine(b);
}

/**
 * Why a session cannot be started, or null when it can.
 *
 * ONE wording for every surface that has to say it — the tooltip on a row you cannot click, the toast when you click its tab anyway, and the pane of a tab you are already sitting on.
 * They answer the same question at three different moments, so they say the same words; three copies of this sentence would drift the first time one of them was reworded.
 *
 * The two cases are worth telling apart.
 * A missing WORKTREE leaves the repo intact and can be cut again at the same path, which is a thing to go and do; a missing PROJECT means the whole checkout is gone and nothing under it can run.
 */
export function unstartableReason(session: SessionSummary): string | null {
  if (session.cwdExists) return null;
  if (session.worktree && session.repoRootExists) {
    return `The worktree “${session.worktree}” is gone, so this session cannot run. Recreate it at ${session.cwd} to use this session again.`;
  }
  return `This session's folder is gone, so it cannot run: ${session.cwd}`;
}

/** What a session's worktree mark says, when it has one. */
export interface WorktreeMarkState {
  /** The session ran in the worktree and has since left it, so the mark is muted, and a resume runs where the session is now. */
  left: boolean;
  tooltip: string;
}

/**
 * The worktree mark a session carries, or null when it has none: one rule for the row's badge, the tab's mark and the worktree filter, so the three cannot disagree about which sessions are worktree sessions.
 * A session that left its worktree keeps a mark because it still did its work there, which is what the mark is for.
 */
export function worktreeMarkState(session: SessionSummary): WorktreeMarkState | null {
  if (session.worktree) return { left: false, tooltip: `Linked git worktree: ${session.worktree}` };
  // Muted either way, since a resume runs where the session is now; the words say which way it left, since closing a session in its worktree is the usual way and moving it out is the rare one.
  if (session.leftWorktree) {
    return {
      left: true,
      tooltip: session.movedOutOfWorktree
        ? `Moved out of linked git worktree: ${session.leftWorktree}; now in ${session.cwd}`
        : `Worked in linked git worktree: ${session.leftWorktree} until it closed; resumes in ${session.cwd}`,
    };
  }
  return null;
}

/**
 * What a session's clock says of the tasks claude has scheduled for it, one line each, its prompt and whether it repeats; null for none, which shows no clock.
 * Claude cuts a long prompt short in what it reports, so the line ends where it did.
 */
export function scheduledText(tasks: readonly ScheduledTask[]): string | null {
  if (tasks.length === 0) return null;
  return ['Scheduled:', ...tasks.map((task) => `${task.prompt} (${task.recurring ? 'repeats' : 'once'})`)].join('\n');
}

/**
 * Whether a project's folder is still there, answered from the sessions filed under it.
 * Every one of them shares the project's repoRoot, so any of them can answer; `some` rather than `every`, so one stale summary cannot condemn a folder that is there.
 * ONE rule for every surface that asks, so the session list and the switcher cannot disagree about which projects are dead.
 */
export function projectRootExists(sessions: readonly SessionSummary[]): boolean {
  return sessions.some((s) => s.repoRootExists);
}

/** Why nothing can be started in a project whose folder is gone: the one sentence for every surface that says it, as `unstartableReason` is for a session, and shaped like it. */
export function projectGoneReason(repoRoot: string): string {
  return `This project's folder is gone, so nothing in it can run: ${repoRoot}`;
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

// A project's own name on disk: the last path segment of its repo root.
export function folderName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
}

// The one place a session's display label is composed: the name Claude gave it, else its first prompt, else what a session with nothing in it is called, after the folder it runs in.
// Every surface shows the same name this way (docs/architecture.md § Reading sessions).
export function sessionLabel(session: SessionSummary): string {
  return session.title || session.firstMessage || `New: ${folderName(session.cwd)}`;
}

// A project's display name: the user's rename override if set, else the folder name.
// Used everywhere a project is labelled (project headings, tab bar, switcher); the full path stays available on hover.
export function displayName(repoRoot: string, names?: ReadonlyMap<string, string>): string {
  return names?.get(repoRoot) || folderName(repoRoot);
}

// Short, human label for a model id, parsed generically (no hardcoded model list): the alphabetic segment is the family, the numeric segments (minus the trailing YYYYMMDD date, either id order) are the version.
// So new models need no code change.
// Examples: claude-opus-4-8 -> "Opus 4.8", claude-fable-5 -> "Fable 5", claude-3-5-haiku-20241022 -> "Haiku 3.5".
// Falls back to the raw id only when there's no family word at all; empty in -> empty out.
export function modelLabel(model: string): string {
  if (!model) return '';
  const segs = model.toLowerCase().split('-').filter((s) => s && s !== 'claude');
  const family = segs.filter((s) => /^[a-z]+$/.test(s)).join(' ');
  if (!family) return model;
  const version = segs.filter((s) => /^\d+$/.test(s) && s.length !== 8).join('.');
  const name = family.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return version ? `${name} ${version}` : name;
}

// Move `moved` to `targetIndex` within the subsequence of items sharing its group key, leaving items of other groups in their slots.
// Pure; used to reorder a tab within its own project.
export function reorderWithinGroup<T>(items: readonly T[], keyOf: (t: T) => string, moved: T, targetIndex: number): T[] {
  const key = keyOf(moved);
  const group = items.filter((t) => keyOf(t) === key);
  const from = group.indexOf(moved);
  if (from === -1) return items.slice();
  group.splice(from, 1);
  group.splice(Math.max(0, Math.min(targetIndex, group.length)), 0, moved);
  let i = 0;
  return items.map((t) => (keyOf(t) === key ? group[i++]! : t));
}

// A short "x min ago" relative time.
// `now` is injectable for tests.
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
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
  /**
   * Show only sessions whose tab rests PAUSED — set aside, with no claude behind it.
   * No session passes it and liveOnly together, since live wants a claude behind the tab: the two on at once show nothing.
   */
  pausedOnly: boolean;
  worktreeOnly: boolean;
  /** Show only sessions that cannot run because their folder is gone — the set worth finding to clean up, or to put a folder back for. */
  goneOnly: boolean;
  /** Show only members of a multi-session family (siblings). */
  siblingOnly: boolean;
  /** Show only sessions whose transcript links a PR. */
  prsOnly: boolean;
  archivedOnly: boolean;
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
  /** Keys of the sessions whose tab rests paused; only consulted when pausedOnly is set. */
  paused?: ReadonlySet<string>;
  /** Set or Map keyed by conversationId; only membership is used. */
  archived: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
  /** Session id -> note, so typed text matches a note as well as a title. */
  notes?: ReadonlyMap<string, string>;
  /** Session key -> its group's name, so typing a group name surfaces everything in it. */
  groupNames?: ReadonlyMap<string, string>;
}

/**
 * Whether a session is in the set a view holds before any filter: the archived view holds the archived sessions, the normal view the rest, and a session on its way to the trash is in neither.
 * One rule for the list, the switcher's counts and the filter count's total, so the total is always the set the matches were taken from.
 */
export function inView(key: string, archivedView: boolean, archived: { has(key: string): boolean }, pendingDeletes: ReadonlySet<string>): boolean {
  return !pendingDeletes.has(key) && archived.has(key) === archivedView;
}

// Whether a session survives every active filter.
// Archived sessions are hidden from the normal list and are the only ones shown in the archived view; the toggle flips which set is visible.
export function sessionPasses(session: SessionSummary, c: FilterCriteria): boolean {
  const key = entityKey(session);
  if (!inView(key, c.archivedOnly, c.archived, c.pendingDeletes)) return false;
  if (c.pinnedOnly && !c.pinned.has(key)) return false;
  if (c.openOnly && !c.open?.has(key)) return false;
  if (c.liveOnly && !c.live?.has(key)) return false;
  if (c.pausedOnly && !c.paused?.has(key)) return false;
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

// A project's rolled-up nudge for the switcher: the strongest UNATTENDED status among its sessions, so a project you're not looking at still shows it needs you.
// Priority waiting > idle > busy; null when nothing needs surfacing.
// A read session waiting or finished is muted and contributes nothing (`nudgeOf`).
export type NudgeStatus = 'waiting' | 'idle' | 'busy' | null;

/**
 * One session's part in a roll-up: its live status, muted to nothing once read; closed, unknown or not reported yet is nothing too.
 * Only waiting and idle can be read (`toggleAck`), and a new status clears the mark, so the mark mutes only those.
 * Work still running behind a finished turn (`background`) is working, so it rolls up as busy: a roll-up must not carry a "finished" that is not true yet.
 */
export function nudgeOf(status: string | undefined, acked: boolean): NudgeStatus {
  if (status === 'waiting' || status === 'idle') return acked ? null : status;
  return status === 'busy' || status === 'background' ? 'busy' : null;
}

export interface SwitcherProject {
  repoRoot: string;
  name: string;
  count: number;
  badge: NudgeStatus;
  /** Whether the project's folder is still there, by the same rule as the session list's headings. */
  rootExists: boolean;
}

export interface SwitcherModel {
  all: { count: number; badge: NudgeStatus };
  projects: SwitcherProject[];
}

/** The nudge that speaks for several: waiting over idle over busy, and nothing when none has one; how sessions roll up into a project and projects into a line. */
export function strongestNudge(nudges: Iterable<NudgeStatus>): NudgeStatus {
  const all = new Set(nudges);
  return all.has('waiting') ? 'waiting' : all.has('idle') ? 'idle' : all.has('busy') ? 'busy' : null;
}

/** Whether a nudge asks something of you: a turn that ended, waiting for you or finished, and not marked read, which `nudgeOf` has already taken away; work in progress asks nothing. */
export function asksForYou(nudge: NudgeStatus): boolean {
  return nudge === 'waiting' || nudge === 'idle';
}

function rollUpNudge(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
): NudgeStatus {
  return strongestNudge(sessions.map((s) => nudgeOf(statuses.get(s.id), acked.has(s.id))));
}

/**
 * The project a folder belongs to, of the ones given: the one it is, else the deepest one it sits under; null for none.
 * How a panel that runs in a fixed folder finds the project a session it starts belongs in.
 */
export function projectFor(roots: readonly string[], dir: string): string | null {
  let best: string | null = null;
  for (const root of roots) {
    const holds = dir === root || dir.startsWith(`${root}/`);
    if (holds && (best === null || root.length > best.length)) best = root;
  }
  return best;
}

/** A project as the switcher and the session list draw it: the sessions shown under it, and when there are none because every one is archived, those. */
interface ProjectEntry {
  shown: SessionSummary[];
  archived: SessionSummary[];
}

/**
 * The projects to draw, in the order you set: one per root among `sessions`, and one, with nothing shown, per root in `archivedOnly` (`archivedOnlyProjects`).
 * The ONE place the switcher and the session list take their projects from, so the two never disagree about which projects there are or where each sits.
 */
function projectEntries(sessions: SessionSummary[], archivedOnly: ReadonlyMap<string, SessionSummary[]>, projectOrder: readonly string[]): [string, ProjectEntry][] {
  const entries: [string, ProjectEntry][] = groupByRepo(sessions).map(([repoRoot, shown]) => [repoRoot, { shown, archived: [] }]);
  for (const [repoRoot, archived] of archivedOnly) entries.push([repoRoot, { shown: [], archived }]);
  return orderProjects(entries, projectOrder);
}

/** The sessions that answer for a project's folder: those shown, or its archived ones when none is, which sit in the same folder. */
const folderWitnesses = ({ shown, archived }: ProjectEntry): SessionSummary[] => (shown.length > 0 ? shown : archived);

// Build the project-switcher model from the VISIBLE tips (one per conversation, already filtered to what the sidebar shows).
// Projects order by recency: the input is recency-sorted, so a project takes the position of its most-recent session (first appearance).
// Per project: session count + the rolled-up nudge badge; plus an "All" aggregate over everything passed.
export function projectsForSwitcher(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  names?: ReadonlyMap<string, string>,
  projectOrder: readonly string[] = [],
  archivedOnly: ReadonlyMap<string, SessionSummary[]> = new Map(),
): SwitcherModel {
  // Same order as the sidebar sections: the switcher is the compact view of the same list, so the two must never disagree about where a project sits.
  const projects = projectEntries(sessions, archivedOnly, projectOrder).map(([repoRoot, entry]) => ({
    repoRoot,
    name: displayName(repoRoot, names),
    count: entry.shown.length,
    badge: rollUpNudge(entry.shown, statuses, acked),
    rootExists: projectRootExists(folderWitnesses(entry)),
  }));
  return {
    all: { count: sessions.length, badge: rollUpNudge(sessions, statuses, acked) },
    projects,
  };
}

// --- The session list's shape -------------------------------------------------------------------- One project section per repo, each holding its groups (in registry order) and then the sessions that are in no group.
// Pure: renderer.ts turns this into DOM, and every ordering rule lives here so it can be tested without a browser.

export interface GroupedSessions {
  group: SessionGroup;
  sessions: SessionSummary[];
}

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
  /** How many sessions it has archived when every one it has is, and so none is shown: the project stays, saying so; 0 for a project with any shown. */
  archived: number;
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
 * Projects keep the order they appear in `sessions` (recency, since the caller sorts that way); inside a project the groups come first in registry order, then the ungrouped remainder.
 *
 * `hideEmptyGroups` is for filtering: a group whose sessions were all filtered out is noise in a search, but an empty group must stay visible normally — that is how a freshly created one is seen.
 * A root in `archivedOnly` is a project with no rows, its `archived` saying how many sessions it has archived (`archivedOnlyProjects`).
 * `known` is every session the app knows, filtered out or not, which answers for what a project's folder is: a filter changes what is shown, not whether the folder is a git repository.
 */
export function buildProjectTree(
  sessions: SessionSummary[],
  state: GroupState,
  pinned: ReadonlySet<string>,
  hideEmptyGroups = false,
  projectOrder: readonly string[] = [],
  archivedOnly: ReadonlyMap<string, SessionSummary[]> = new Map(),
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

  return projectEntries(sessions, archivedOnly, projectOrder).map(([repoRoot, entry]) => {
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
      archived: entry.shown.length > 0 ? 0 : entry.archived.length,
    };
  });
}

/**
 * THE TAB BAR'S ORDER, as clusters: per project, the ungrouped items first and then one run per group in registry order, with each run left exactly as it was handed over.
 *
 * ONE implementation for the tab bar and the live strip, called identically by both — they draw the same tabs, and a second copy of "project, then group in registry order" is the kind of thing that drifts between the times anyone looks.
 * Projects come from the explicit project order, so the bar, the strip and the sidebar all agree about where a project sits.
 * The bar used to order them by whichever it met first, which nobody chose and which moved on its own.
 *
 * WHY TAB ORDER AT ALL, for the strip.
 * A list you read while working needs to stay where you last saw it more than it needs to be sorted well, and two earlier answers failed that.
 * Sorting attention-first reshuffled both levels on every status change.
 * Ordering as the SESSION LIST does was closer and still wrong, because the sidebar's within-project order is RECENCY — and most sessions in the strip are running, so those timestamps are all moving and two rows swap whenever the lower one writes a message.
 * The tabs array cannot move on its own: it changes when you open, close, drag, or regroup a tab.
 *
 * Pins are deliberately NOT floated, unlike the sidebar.
 * A pin says where a session belongs in the LIST; the tab bar has never honoured it, and floating one here would be a second thing able to move a row you were reading.
 */
export function orderAsTabs<T>(
  entries: readonly TabCluster<T>[],
  groupIdsFor: (repoRoot: string) => readonly string[],
  projectOrder: readonly string[] = [],
): { repoRoot: string; groupId: string; items: T[] }[] {
  const byCluster = new Map<string, T[]>();
  const seen: [string, null][] = [];
  for (const { repoRoot, groupId, item } of entries) {
    if (!byCluster.has(`${repoRoot}\0`) && !seen.some(([r]) => r === repoRoot)) seen.push([repoRoot, null]);
    // A group belonging to ANOTHER project cannot be rendered under this one, so such an item is LOOSE here rather than invisible — the same rule the sidebar's tree applies.
    const known = groupId && groupIdsFor(repoRoot).includes(groupId);
    const key = `${repoRoot}\0${known ? groupId : ''}`;
    byCluster.set(key, [...(byCluster.get(key) ?? []), item]);
  }
  const out: { repoRoot: string; groupId: string; items: T[] }[] = [];
  for (const [repoRoot] of orderProjects(seen, projectOrder)) {
    const loose = byCluster.get(`${repoRoot}\0`);
    if (loose?.length) out.push({ repoRoot, groupId: '', items: loose });
    for (const groupId of groupIdsFor(repoRoot)) {
      const items = byCluster.get(`${repoRoot}\0${groupId}`);
      if (items?.length) out.push({ repoRoot, groupId, items });
    }
  }
  return out;
}

/** One thing to place: which project it belongs to, which group it is in (`''` for none), and the thing itself. */
export interface TabCluster<T> {
  repoRoot: string;
  groupId: string;
  item: T;
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

/**
 * What each status is CALLED.
 * States, phrased as states: a dot answers "what is this session doing", not "what just happened to it".
 * `closed` is "Not running" rather than "Stopped" for that reason — it arrives from SessionEnd, which fires whether you stopped the session, claude finished, or the tab closed, so naming the event would be wrong in two of those three cases.
 */
const STATUS_LABEL: Record<string, string> = {
  busy: 'Busy',
  idle: 'Idle',
  // The turn has ended and claude's prompt is open, but work it started still runs.
  background: 'Working in the background',
  waiting: 'Waiting for you',
  closed: 'Not running',
  // Not statuses a hook reports: what the dot of a session whose tab rests paused, or whose claude was asked to leave and has not, shows in place of its last one (`dotStatus`).
  paused: 'Paused — opening it resumes the session',
  pausing: 'Pausing — waiting for claude to leave',
  stopping: 'Stopping — waiting for claude to leave',
};

/**
 * A status dot's tooltip: the status as a label, plus whether it has been marked read.
 * Here rather than beside the dot it decorates, because the wording is the thing worth pinning — an unknown status used to render its own internal value at the user.
 *
 * It still falls back to the raw value, deliberately: a state this table has not been taught reads oddly rather than vanishing, which is the signal to name it.
 * That only works while everything reaching here is MEANT to be a state — the identity marker `start` is not, and is filtered out where it is read rather than hidden here.
 *
 * `background` also says what still runs, from the type claude gives each piece of work (`background`), counted per type: "2 shells, 1 subagent".
 */
export function statusLabel(status: string | undefined, isAcked = false, background: readonly string[] = []): string | null {
  if (!status) return null;
  const label = status === 'background' && background.length > 0 ? `${STATUS_LABEL.background}: ${countedTypes(background)}` : (STATUS_LABEL[status] ?? status);
  return showsRead(status, isAcked) ? `${label} (read)` : label;
}

/** "2 shells, 1 subagent": each type once, in the order it first appears, with how many there are. */
function countedTypes(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`).join(', ');
}

/**
 * Whether a dot showing `status` shows the session's mark read, by its tooltip and its dimming alike (`sessionDotClass`).
 * A dot showing what its tab does never does, paused, pausing or stopping: it reports no claude, or one on its way out, so there is nothing on it to have read, and a mark made before would dim it for nothing.
 */
export function showsRead(status: string | null | undefined, acked: boolean): boolean {
  return acked && !TAB_DOTS.has(status ?? '');
}

/** The states a session's dot takes from its tab rather than from its hooks (`dotStatus`). */
const TAB_DOTS: ReadonlySet<string> = new Set(['paused', 'pausing', 'stopping']);

/**
 * The live strip's line: how many of its sessions run and how many of those want you, then how many tabs are paused.
 * Counting ATTENTION rather than rows: a plain count of running sessions would report five wanting you when four are working away happily, and a paused one wants nothing.
 */
export function stripLine(live: number, needing: number, paused: number): string {
  const running = needing > 0 ? `${needing} of ${live} need you` : live > 0 ? `${live} live` : '';
  return [running, paused > 0 ? `${paused} paused` : ''].filter(Boolean).join(' · ');
}

/**
 * Enough of a tab to know what its button should say: whether it has a process, four of the flags a tab's data carries (`TabState`, in state/app.ts), and nothing of its terminal.
 * The flags are optional, so a caller can name only the one it is about: absent means "not in that transition", which is the same thing as false and is why every check on them is a truthiness test.
 */
export interface TabButtonTab {
  /** Its process, or null for a cold tab. */
  terminalId: number | null;
  /** A process is on its way. */
  starting?: boolean;
  /** A process is on its way out. */
  stopping?: boolean;
  /** It has been on its way out long enough that the control now forces it. */
  forceable?: boolean;
  /** Set aside: on its way out, that is a pause rather than a stop. */
  paused?: boolean;
}

/**
 * The mark on a tab's button: the stop square, or the pause bars while a pause is on its way, each filled once a press forces the session out, or the cross once there is only a tab to close (`tabButtonIcon`).
 * A force is named for what was asked, so a pause that has not landed still says it is a pause.
 */
export type TabButtonMark = 'stop' | 'pause' | 'force-stop' | 'force-pause' | 'close';

/** The marks with a press, and so a label: the pause bars are only ever drawn unavailable, for a pause on its way that is not yet a force. */
export type TabButtonPress = Exclude<TabButtonMark, 'pause'>;

/** What a tab's button shows and does, and the words of the item in the session's menu that presses it. */
export interface TabButton {
  disabled: boolean;
  tooltip: string;
  mark: TabButtonMark;
  label: string;
}

/**
 * What a tab's button shows, wherever it is drawn: on the tab, and on the live strip's row for its session; and the session menu's item for it.
 *
 * Both ends of a session's life are a pause, for the same reason: neither a tab whose process has not arrived yet nor one whose process is still leaving can be acted on without the UI disagreeing with what is actually running.
 * Except that a session asked to leave may never go: claude can ask something on its way out and wait for the answer, and nothing it sends tells that from a claude that hangs.
 * So after a moment the pause becomes a FORCE, its mark filled, which ends it without asking; the moment is what keeps a double-click from forcing before the question is even on screen.
 * While it leaves, the mark and the menu's item say what was asked, a pause or a stop, and the item is that force from the start, unavailable for the moment, since asking claude again could only land on what it is asking.
 * A cold tab has nothing to stop, so the button closes it.
 * ONE RULE RATHER THAN TWO, and it is here rather than in the renderer because the two surfaces did come to different conclusions about the same tab the day the strip grew its own copy.
 */
export function tabButtonState(tab: TabButtonTab): TabButton {
  // Starting is checked FIRST, and the order matters: a tab can carry both flags, and what it is doing is arriving, not leaving.
  if (tab.starting) return { disabled: true, tooltip: 'Starting…', mark: 'stop', label: tabButtonLabel('stop') };
  if (tab.stopping) {
    const force = tab.paused ? 'force-pause' : 'force-stop';
    const label = tabButtonLabel(force);
    if (tab.forceable) return { disabled: false, tooltip: `${label}: claude has not left yet — it may be asking you something`, mark: force, label };
    return { disabled: true, tooltip: tab.paused ? 'Pausing…' : 'Stopping…', mark: tab.paused ? 'pause' : 'stop', label };
  }
  if (tab.terminalId === null) return { disabled: false, tooltip: tabButtonLabel('close'), mark: 'close', label: tabButtonLabel('close') };
  return { disabled: false, tooltip: tabButtonLabel('stop'), mark: 'stop', label: tabButtonLabel('stop') };
}

/** What a press on a tab's button does, in words: the label of the item in the session's menu that presses it, and the button's tooltip while it can act (for a force, its first words). */
export function tabButtonLabel(press: TabButtonPress): string {
  return { stop: 'Stop session', 'force-stop': 'Force stop', 'force-pause': 'Force pause', close: 'Close tab' }[press];
}

/**
 * Does this chunk put anything on screen?
 *
 * The first BYTES out of the pty are not the first thing you can see: measured, claude sends three chunks of pure terminal setup — save/restore cursor, scroll region, bracketed paste, focus reporting — before any content.
 * Clearing the loader on those flashed it away and left the pane empty again, which on a resume is seconds of nothing while the transcript renders.
 *
 * Strips escape sequences with the stripper the command panel uses, then the remaining control characters, and asks whether anything is left.
 * A sequence the chunk ends partway through counts as nothing yet, rather than as the text it starts with.
 * Erring towards "not visible" is the safe direction: the loader stays a moment longer rather than uncovering an empty pane.
 */
export function hasVisibleOutput(data: string): boolean {
  const [complete] = splitPendingEscape(data);
  // eslint-disable-next-line no-control-regex
  return stripAnsi(complete).replace(/[\x00-\x1f\x7f]/g, '').trim().length > 0;
}
