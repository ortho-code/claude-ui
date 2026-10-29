// Pure sidebar logic, kept free of DOM/globals so it can be unit-tested.
// renderer.ts wires these to its state and the DOM.
import { prReference } from '../shared/prs';
import { timeOfDay } from '../shared/settings';
import type { GroupState, Later, NeedsYou, NeedsYouReason, ScheduledTask, SessionGroup, SessionSummary } from '../shared/types';
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
  // Not drawn on the row, but the panels read it from the tab, and a tab hears of a re-read session only when its row would change (`sameTabs`, state/app.ts).
  workCwd: true,
  // Drawn as the worktree mark's count and list, and a running session changes files in another checkout.
  checkouts: true,
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
  /** The session neither runs in a worktree nor works in one (`workCwd`), though it ran in one or changed files in one, so the mark is muted. */
  muted: boolean;
  tooltip: string;
  /** How many checkouts its list holds (`checkouts`); 0 when it has none, and then the mark lists nothing. */
  count: number;
}

/**
 * The worktree mark a session carries, or null when it has none: one rule for the row's badge, the tab's mark and the worktree filter, so the three cannot disagree about which sessions are worktree sessions.
 * A session that left its worktree keeps a mark because it still did its work there, which is what the mark is for; so does one that changed files in a worktree it never entered, by path or after a `cd`.
 * In the accent while the session runs in a worktree or works in one, so a session whose panels follow it into a worktree wears it as a worktree session; one in a worktree whose panels follow it into the main checkout keeps the accent, while their header names the main checkout.
 */
export function worktreeMarkState(session: SessionSummary): WorktreeMarkState | null {
  const count = session.checkouts.length;
  if (!session.worktree && !session.leftWorktree && count === 0) return null;
  const work = workWorktree(session);
  const says: string[] = [];
  if (session.worktree) says.push(`Linked git worktree: ${session.worktree}`);
  // The words say which way it left, since closing a session in its worktree is the usual way and moving it out is the rare one; a resume runs where the session is now either way.
  else if (session.leftWorktree) {
    says.push(
      session.movedOutOfWorktree
        ? `Moved out of linked git worktree: ${session.leftWorktree}; now in ${session.cwd}`
        : `Worked in linked git worktree: ${session.leftWorktree} until it closed; resumes in ${session.cwd}`,
    );
  }
  if (session.workCwd) says.push(`its panels follow it into ${work ? `linked git worktree: ${work}` : 'the main checkout'}`);
  if (count > 0) says.push(`${count === 1 ? '1 checkout' : `${count} checkouts`} it worked in`);
  const tooltip = says.join('; ');
  return { muted: !session.worktree && !work, tooltip: `${tooltip.charAt(0).toUpperCase()}${tooltip.slice(1)}`, count };
}

/** The linked worktree a session works in (`workCwd`); '' when that is the main checkout, or the folder the session runs in. */
export function workWorktree(session: Pick<SessionSummary, 'workCwd' | 'repoRoot'>): string {
  return session.workCwd ? worktreeAt(session.workCwd, session.repoRoot) : '';
}

/** The linked worktree a checkout's root is, named by its folder as main names a worktree; '' for the main checkout, whose root is the repo's. */
export function worktreeAt(root: string, repoRoot: string): string {
  return root !== repoRoot ? folderName(root) : '';
}

/**
 * What becomes of a task when its session's claude goes, said beside it wherever it is named, so it is known before a stop rather than asked at it.
 * Measured on claude 2.1.302: a cron, one-shot or repeating, came back with the same id when the session was resumed, whether claude's own question was answered "Exit and stop tasks" or the session was forced out; a `/loop` wakeup did not.
 */
export function afterStop(task: ScheduledTask): string {
  return task.cron === null ? 'ends with the session' : 'comes back when you open the session';
}

/**
 * What a session's clock says of the tasks claude has scheduled for it, under its heading, one line each: its prompt, a cron's schedule in claude's words, and what a stop does to it (`afterStop`); null for none, which shows no clock.
 * Claude cuts a long prompt short in what it reports, so the line ends where it did.
 */
export function scheduledLines(tasks: readonly ScheduledTask[], heading = 'Scheduled:'): string[] | null {
  if (tasks.length === 0) return null;
  return [heading, ...tasks.map((task) => [task.prompt, task.cron, afterStop(task)].filter((part) => part !== null).join(' · '))];
}

/** What a session's clock shows: its tasks, and whether they are the ones its tab kept from when its claude went (`stopped`), which the clock shows muted. */
export interface ClockShown {
  tasks: readonly ScheduledTask[];
  stopped: boolean;
}

/**
 * What a session's clock shows, ONE rule for its tab, its row and its strip row: what its claude last reported scheduled (`live`), or else, muted, what its tab kept from when its claude went (`TabState.scheduledWhenStopped`); null for neither.
 * A tab keeps those through a start of its claude until that claude reports, since a start says nothing of what it brought back, and a `/loop` wakeup among them may not come back.
 */
export function clockOf(live: readonly ScheduledTask[] | undefined, tab: { scheduledWhenStopped: readonly ScheduledTask[] | null } | undefined): ClockShown | null {
  if (live && live.length > 0) return { tasks: live, stopped: false };
  if (tab?.scheduledWhenStopped) return { tasks: tab.scheduledWhenStopped, stopped: true };
  return null;
}

/** What a clock says, line by line: its tasks under the heading for live ones or for the ones a stopped tab kept (`scheduledLines`); null for no clock. */
export function clockLines(clock: ClockShown | null): string[] | null {
  return clock ? scheduledLines(clock.tasks, clock.stopped ? 'Scheduled when stopped:' : 'Scheduled:') : null;
}

/** What a clock says, wherever it is said as one text, such as its tooltip (`clockLines`); null for no clock. */
export function clockText(clock: ClockShown | null): string | null {
  return clockLines(clock)?.join('\n') ?? null;
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
  /** Show only sessions marked for later, with a tab or without. */
  laterOnly: boolean;
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
  /** Keys of the sessions marked for later; only consulted when laterOnly is set. */
  later?: { has(key: string): boolean };
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
  if (c.laterOnly && !c.later?.has(key)) return false;
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
// Priority waiting > needs > idle > busy; null when nothing needs surfacing.
// A read session waiting, needing you or finished is muted and contributes nothing (`nudgeOf`).
export type NudgeStatus = 'waiting' | 'needs' | 'idle' | 'busy' | null;

/**
 * What a session shows of its claude's status and its needs-you mark, one rule for its dot and for every roll-up: the mark where claude says nothing more pressing.
 * Busy and background show over it, since claude is then working, and waiting does, since claude then asks you something; idle, closed and no status at all give way to it.
 */
export function shownStatus(status: string | undefined, needsYou: boolean): string | undefined {
  if (status === 'busy' || status === 'background' || status === 'waiting') return status;
  return needsYou ? 'needs' : status;
}

/**
 * One session's part in a roll-up: what it shows (`shownStatus`), muted to nothing once read; closed, unknown or not reported yet is nothing too.
 * Only waiting, needs and idle can be read (`toggleAck`), and a new status clears the mark, so the mark mutes only those.
 * Work still running behind a finished turn (`background`) is working, so it rolls up as busy: a roll-up must not carry a "finished" that is not true yet.
 */
export function nudgeOf(status: string | undefined, acked: boolean): NudgeStatus {
  if (status === 'waiting' || status === 'needs' || status === 'idle') return acked ? null : status;
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

/** The nudge that speaks for several: waiting over needs over idle over busy, and nothing when none has one; how sessions roll up into a project and projects into a line. */
export function strongestNudge(nudges: Iterable<NudgeStatus>): NudgeStatus {
  const all = new Set(nudges);
  return all.has('waiting') ? 'waiting' : all.has('needs') ? 'needs' : all.has('idle') ? 'idle' : all.has('busy') ? 'busy' : null;
}

/** Whether a nudge asks something of you: waiting for you, marked as needing you, or a turn that finished, and not marked read, which `nudgeOf` has already taken away; work in progress asks nothing. */
export function asksForYou(nudge: NudgeStatus): boolean {
  return nudge === 'waiting' || nudge === 'needs' || nudge === 'idle';
}

/**
 * A session's part in a roll-up, by the rule its dot follows: what it shows (`shownStatus`), muted to nothing once read, and a needs-you mark its later mark mutes (`mutedByLater`) is read wherever the dot shows it, so it rolls up as nothing too (decided 2026-10-29).
 * Claude working or asking shows over the mark, and so still counts.
 */
export function sessionPart(status: string | undefined, marked: boolean, muted: boolean, acked: boolean): NudgeStatus {
  const shown = shownStatus(status, marked);
  return nudgeOf(shown, acked || (muted && shown === 'needs'));
}

function rollUpNudge(
  sessions: SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  needsYou: ReadonlyMap<string, unknown>,
  muted: ReadonlySet<string>,
): NudgeStatus {
  return strongestNudge(sessions.map((s) => sessionPart(statuses.get(s.id), needsYou.has(entityKey(s)), muted.has(entityKey(s)), acked.has(s.id))));
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
  needsYou: ReadonlyMap<string, unknown>,
  names?: ReadonlyMap<string, string>,
  projectOrder: readonly string[] = [],
  archivedOnly: ReadonlyMap<string, SessionSummary[]> = new Map(),
  muted: ReadonlySet<string> = new Set(),
): SwitcherModel {
  // Same order as the sidebar sections: the switcher is the compact view of the same list, so the two must never disagree about where a project sits.
  const projects = projectEntries(sessions, archivedOnly, projectOrder).map(([repoRoot, entry]) => ({
    repoRoot,
    name: displayName(repoRoot, names),
    count: entry.shown.length,
    badge: rollUpNudge(entry.shown, statuses, acked, needsYou, muted),
    rootExists: projectRootExists(folderWitnesses(entry)),
  }));
  return {
    all: { count: sessions.length, badge: rollUpNudge(sessions, statuses, acked, needsYou, muted) },
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
  needsYou: ReadonlyMap<string, unknown>,
  muted: ReadonlySet<string> = new Set(),
): GroupJumpTarget[] {
  const targets: GroupJumpTarget[] = project.groups.map(({ group, sessions }) => ({
    groupId: group.id,
    name: group.name,
    count: sessions.length,
    badge: rollUpNudge(sessions, statuses, acked, needsYou, muted),
  }));
  if (project.loose.length > 0) {
    targets.push({
      groupId: null,
      name: 'Ungrouped',
      count: project.loose.length,
      badge: rollUpNudge(project.loose, statuses, acked, needsYou, muted),
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
  // Not a status a hook reports: what the dot of a session whose claude was asked to leave and has not shows in place of its last one (`dotStatus`).
  stopping: 'Stopping — waiting for claude to leave',
};

/** What a session marked as needing you shows (`shownStatus`), by why it was marked: how the app closed while it ran, or the day you set it aside for, from when it was marked. */
const NEEDS_LABEL: Record<NeedsYouReason, (at: number) => string> = {
  quit: () => 'Needs you — was running when the app quit',
  ended: () => 'Needs you — was running when the app ended without quitting',
  unknown: () => 'Needs you — was running when the app last closed',
  reminder: (at) => `Needs you — reminder for ${momentLabel(at)}`,
};

/** A day as the later mark names it: "Mon 3 Nov", in the app's own short form whatever the system's language, as the rest of its words are English. */
export function dayLabel(at: number): string {
  const day = new Date(at);
  return `${WEEKDAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]}`;
}

/** A moment as the later mark names it: its day and its time in 24 hours, "Mon 3 Nov, 09:00". */
export function momentLabel(at: number): string {
  const moment = new Date(at);
  return `${dayLabel(at)}, ${String(moment.getHours()).padStart(2, '0')}:${String(moment.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The start of the local day `days` after the one `now` falls in: tomorrow for 1. */
export function dayStart(now: number, days: number): number {
  const day = new Date(now);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + days).getTime();
}

/** `time` ("HH:MM", `Settings.laterTime`) on the local day `day` falls in: when a later mark set for that day comes due, the day's start for a time that does not read. */
export function onDayAt(day: number, time: string): number {
  const at = new Date(day);
  const { hours, minutes } = timeOfDay(time) ?? { hours: 0, minutes: 0 };
  return new Date(at.getFullYear(), at.getMonth(), at.getDate(), hours, minutes).getTime();
}

/** What a session's later mark says, on its tooltip and in its menu's header: "Later", or "Later: Mon 3 Nov, 09:00" for one with a day. */
export function laterLabel(later: Later): string {
  return later.due === null ? 'Later' : `Later: ${momentLabel(later.due)}`;
}

/**
 * A status dot's tooltip: the status as a label, plus whether it has been marked read.
 * Here rather than beside the dot it decorates, because the wording is the thing worth pinning — an unknown status used to render its own internal value at the user.
 *
 * It still falls back to the raw value, deliberately: a state this table has not been taught reads oddly rather than vanishing, which is the signal to name it.
 * That only works while everything reaching here is MEANT to be a state — the identity marker `start` is not, and is filtered out where it is read rather than hidden here.
 *
 * `background` also says what still runs, from the type claude gives each piece of work (`background`), counted per type: "2 shells, 1 subagent".
 * `needs` says why, from the session's mark (`needsYou`).
 */
export function statusLabel(status: string | undefined, isAcked = false, background: readonly string[] = [], needsYou?: NeedsYou): string | null {
  if (!status) return null;
  const label =
    status === 'background' && background.length > 0
      ? `${STATUS_LABEL.background}: ${countedTypes(background)}`
      : status === 'needs'
        ? NEEDS_LABEL[needsYou?.reason ?? 'unknown'](needsYou?.at ?? 0)
        : (STATUS_LABEL[status] ?? status);
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
 * A dot showing what its tab does, stopping, never does: it reports a claude on its way out, so there is nothing on it to have read, and a mark made before would dim it for nothing.
 */
export function showsRead(status: string | null | undefined, acked: boolean): boolean {
  return acked && status !== 'stopping';
}

/**
 * The live strip's line: how many of its rows want you, among those running or marked as needing you (`among`), else how many run and how many are marked but seen.
 * Counting ATTENTION rather than rows: a plain count of running sessions would report five wanting you when four are working away happily.
 * A marked row wants you whether or not it runs, so a launch that marked three cold tabs reads "3 of 3 need you"; once seen (marked read), a cold one is counted as marked, since it does not run.
 */
export function stripLine({ live, needing, among }: { live: number; needing: number; among: number }): string {
  const inHand = needing > 0 ? [`${needing} of ${among} need you`] : [live > 0 ? `${live} live` : '', among > live ? `${among - live} marked` : ''];
  return inHand.filter(Boolean).join(' · ');
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
  /** It has been on its way out long enough to say so where it shows without a hover (`notLeftWords`). */
  notLeft?: boolean;
  /** What its exit does once claude has gone, while it is on its way out: keep the tab (`cool`, the default), remove it, or remove it and archive its session. */
  onExit?: 'cool' | 'close' | 'archive';
}

/**
 * What a tab's claude can be asked to leave for, each one press of its own meaning (decided 2026-10-28): a stop keeps the tab, cold, a close removes it, and an archive removes it and archives its session, each waiting out what claude asks on its way out.
 */
export type LeaveAction = 'stop' | 'close' | 'archive';

/**
 * The mark on a tab's button and its menu's items: the stop square, the cross, or the lidded box (`tabButtonIcon`).
 * Each has a force, which ends a claude that has not left without asking: the stop square filled, and for a close and an archive the filled square with their own mark cut through it.
 */
export type TabButtonMark = LeaveAction | `force-${LeaveAction}`;

/** What a tab's button, or one of its menu's leave items, shows and does: `action` is what a press asks for, and the item's words are `label`. */
export interface TabButton {
  disabled: boolean;
  tooltip: string;
  mark: TabButtonMark;
  label: string;
  action: LeaveAction;
}

const LEAVE_WORDS: Record<LeaveAction, { label: string; force: string; going: string }> = {
  stop: { label: 'Stop session', force: 'Force stop', going: 'Stopping…' },
  close: { label: 'Close tab', force: 'Force close', going: 'Closing…' },
  archive: { label: 'Archive', force: 'Force archive', going: 'Archiving…' },
};

/** What a press on a leave item does, in words: its label, and the button's tooltip while it can act. */
export function leaveLabel(action: LeaveAction): string {
  return LEAVE_WORDS[action].label;
}

/** What a tab that is on its way out is leaving for: what its exit will do; null while it is not leaving. */
export function leaveUnderWay(tab: TabButtonTab): LeaveAction | null {
  if (!tab.stopping) return null;
  return tab.onExit === 'close' || tab.onExit === 'archive' ? tab.onExit : 'stop';
}

const available = (action: LeaveAction): TabButton => ({ disabled: false, tooltip: LEAVE_WORDS[action].label, mark: action, label: LEAVE_WORDS[action].label, action });
const unavailable = (action: LeaveAction, why: string): TabButton => ({ disabled: true, tooltip: why, mark: action, label: LEAVE_WORDS[action].label, action });

/**
 * The force of what a tab is leaving for, named for it: Force stop, Force close or Force archive.
 * A session asked to leave may never go: claude can ask something on its way out and wait for the answer, and nothing it sends tells that from a claude that hangs.
 * So after a moment the force ends it without asking; the moment, when it is unavailable, is what keeps a double-click from forcing before the question is even on screen, and it is unavailable again once forced, until the exit lands.
 */
function leaveForce(tab: TabButtonTab, under: LeaveAction): TabButton {
  const { force, going } = LEAVE_WORDS[under];
  if (tab.forceable) return { disabled: false, tooltip: `${force}: claude has not left yet — it may be asking you something`, mark: `force-${under}`, label: force, action: under };
  return { disabled: true, tooltip: going, mark: under, label: force, action: under };
}

/**
 * A leave item of a tab's menu, by one rule for every surface that draws it: Stop session, Close tab or Archive.
 *
 * Starting is checked FIRST, and the order matters: a tab can carry both flags, and what it is doing is arriving, not leaving, so there is no claude yet to ask.
 * While claude is on its way out, the item of what was asked is its force (decided 2026-10-28), and the others change what the exit does without asking claude again, since a second pair of presses ends what it asks on its way out unanswered: Stop session turns a close or an archive back into a stop, Close tab and Archive turn a leave into theirs.
 * A cold tab has nothing to stop; it closes and archives at once.
 */
export function leaveAction(tab: TabButtonTab, action: LeaveAction): TabButton {
  if (tab.starting) return unavailable(action, 'Starting…');
  const under = leaveUnderWay(tab);
  if (under === action) return leaveForce(tab, under);
  if (under === null && tab.terminalId === null && action === 'stop') return unavailable('stop', 'Not running');
  return available(action);
}

/**
 * What a tab's button shows, wherever it is drawn: on the tab, and on the live strip's row for its session.
 * A shortcut to one of its menu's leave items, so it says and does what that item would (`leaveAction`): Stop session on a running tab, and on a cold one what `stopped` names; while claude is on its way out, the force of what it is leaving for, so the button stays the press that ends claude, and changing what the exit does is the menu's.
 * ONE RULE RATHER THAN TWO, and it is here rather than in the renderer because the two surfaces did come to different conclusions about the same tab the day the strip grew its own copy.
 */
export function tabButton(tab: TabButtonTab, stopped: 'close' | 'archive' = 'close'): TabButton {
  if (tab.starting) return unavailable('stop', 'Starting…');
  const under = leaveUnderWay(tab);
  if (under) return leaveForce(tab, under);
  return leaveAction(tab, tab.terminalId === null ? stopped : 'stop');
}

/**
 * The words beside a session's name, on its tab, its list row and its strip row, for a stop claude has not answered by leaving a while after the ask; null otherwise.
 * The button's own words say the same, but only on a hover, and the question claude may be asking is out of sight on a tab not on show.
 */
export function notLeftWords(tab: TabButtonTab): string | null {
  return tab.stopping && tab.notLeft ? "hasn't left" : null;
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
