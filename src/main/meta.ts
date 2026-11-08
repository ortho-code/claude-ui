import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { SetAside, NeedsYou, ClosedHow, SettledBy, SettledNeedsYou, OrderMove, GroupState, HistoryPin, PrChange, PrNeedsYouType, PrRole, PrSeen, PrStatus, ScheduledTask, SessionGroup, SessionPr, UiState, Settings } from '../shared/types';
import { scheduledTasksOf } from '../shared/scheduled';
import type { PanelState } from '../shared/panels';
import { defaultSettings, defaultUi } from '../shared/defaults';
import type { WindowBounds } from './bounds';
import { createdGroup, movedGroup, movedProject, renamedGroup, seededOrder, withoutGroup, withSessionInGroup } from '../shared/grouping';
import { finishedFrom, cameDue, clearedSetAside, HISTORY_KEPT, keptFrom, markedSetAside, markedWithHistory, purgedSession, restoredNeedsYou, settledNeedsYou, settledTypes, togglePinned, clearedFinished, unkept, withPrLink } from '../shared/sessionmarks';
import { withText } from '../shared/text';
import { isPrReason, isPrType, PR_TYPES } from '../shared/needsyou';
import { PR_ROLES, prFromUrl, referenceKey } from '../shared/prs';
import { appendStamped } from './stamp';
import { goodCopy, writeWithBackups } from './backup';
import { errorText, fsFailure, log, logOnce } from './log';
import { inTurn } from './queue';

/** The preferences as kept here before the config folder: the launch flags, the one setting there was. */
type MetaSettings = Pick<Settings, 'launchFlags'>;

/**
 * UI-only metadata, kept outside ~/.claude so we never touch the session store.
 * `pinned` and `openSessions` hold session ids (the .jsonl file ids).
 * Session ids are immutable, unlike the conversation keys of v2, which stopped matching their session the moment it gained a sibling (the row then keys by its own id) — silently losing tabs and pins.
 */
interface Meta {
  pinned: string[];
  /**
   * Requests and claude's messages pinned in a session's history, by their ids.
   * See HistoryPin.
   */
  historyPins: Record<string, HistoryPin>;
  openSessions: string[];
  /**
   * The open sessions that were running when the window last wrote the open tabs: a session is in it from its tab's start until its process has gone, so one still being stopped counts.
   * The window stops writing the open tabs once the app quits, so the quit's own exits leave it as it was, and a launch reads what was running when the app closed before its restore writes the open tabs again.
   */
  runningSessions: string[];
  /**
   * Open session -> the crons claude had scheduled for it when its claude went, which come back when it is opened again, so its stopped tab still says so at the next launch.
   * Written beside the open tabs, in a write of its own (`setScheduledWhenStopped`); a session that is not open is dropped.
   */
  scheduledWhenStopped: Record<string, ScheduledTask[]>;
  /**
   * Which open session was last looked at, so a restart lands you where you left off.
   * Without it the app opened on whichever tab happened to be LAST in openSessions — harmless while every tab was started at launch, but tabs are restored COLD now, and landing on an arbitrary cold one is worse than landing on none.
   */
  activeSession: string | null;
  /**
   * repoRoot -> the session last looked at in THAT project, so switching back to a project returns you where you were.
   * The in-memory `activatedSeq` already does this within one run, but it resets to 0 on restore, which makes "most recent" meaningless exactly when you need it most.
   */
  activeSessionByProject: Record<string, string>;
  /**
   * Finished session ids mapped to when they were finished (epoch ms; 0 = unknown).
   * Stored as `archived` before the act was called Finished, read from there until a write drops it (decided 2026-11-05).
   */
  finished: Record<string, number>;
  /** The project the sidebar switcher is scoped to (repoRoot), or null for "All". */
  activeProject: string | null;
  /** Per-project display-name overrides, keyed by repoRoot; absent = use the folder name. */
  projectNames: Record<string, string>;
  /**
   * repoRoots in display order.
   * Empty means "never seeded"; the first seed fills it from recency.
   */
  projectOrder: string[];
  /**
   * Free-text note per session id.
   * An empty note is deleted, so presence here means there IS one.
   */
  notes: Record<string, string>;
  /**
   * The sessions marked as needing you, by session id: every reason, each with since when.
   * Kept whether or not a tab holds the session, so a mark outlives a launch that leaves it unopened, until the window takes it off for a prompt there, Clear needs you, a close or your leaving claude, or main does for a finish or a delete.
   * Written with each reason's older form beside its type (`storedNeedsYou`), so a build from before reasons had types still reads every mark.
   */
  needsYou: Record<string, NeedsYou[]>;
  /**
   * Each session's settled reasons, by session id, newest first: what marked it, when, and what settled it, the newest `HISTORY_KEPT` kept.
   * Written in the same write that takes a reason off `needsYou`, so the two never disagree; goes with its session's delete, and stays through a finish.
   * A build from before it keeps it untouched through `extra`, and records nothing it settles.
   */
  needsYouHistory: Record<string, SettledNeedsYou[]>;
  /**
   * The sessions you set aside, by session id: the day each comes back as needing you, or none for whenever, and since when.
   * Kept whether or not a tab holds the session, until the window takes it off for a prompt there or Clear set aside, its day comes (`cameDue`), or main does for a finish or a delete.
   */
  setAside: Record<string, SetAside>;
  /**
   * When each session was last kept out of the review, by session id (epoch ms): the review's own term says how long that holds (`kept:<30d`), so a stamp is never swept, and goes with its session's delete.
   * Finishing leaves it, since a finished session is out of the review anyway.
   */
  kept: Record<string, number>;
  /**
   * The PRs the app linked each session to, by session id, in the order linked: the one a panel's row started it for, which no transcript names until the session acts on it.
   * Finishing leaves them, and they go with the session's delete.
   */
  prLinks: Record<string, SessionPr[]>;
  /**
   * What was last seen of each PR the sessions link, by reference: what the window tells a PR's change from, which marks the sessions linking it (`prChanges`).
   * Null before it was ever kept, the first run; emptied when PR status is turned off, so turning it on again starts from the PRs as they are then (decided 2026-10-29).
   */
  prSeen: PrSeen | null;
  /**
   * Size and position of the window as it was last left, or null until it has been.
   * The size stored is always the unmaximized one, with `maximized` recorded beside it, so restoring a maximized window still knows how big to make it when it is un-maximized.
   */
  windowBounds: WindowBounds | null;
  /**
   * How the sidebar was left: search, filters, folds, width, scroll.
   * See UiState.
   */
  ui: UiState;
  /**
   * Deliberate preferences, kept apart from `ui` so resetting one cannot wipe the other.
   * See Settings.
   * Read once more since they moved into the config folder (`moved`), and never written: an older build still finds them here.
   * Only the launch flags were ever kept here, so a setting added since has no place in it.
   */
  settings: MetaSettings;
  /** What has moved from here into the config folder, by name; see `getMoved`. */
  moved: string[];
  /** User-defined session groups, in display order (a new one is prepended). */
  groups: SessionGroup[];
  /** Session id -> group id; a session is in at most one group. */
  groupOf: Record<string, string>;
  /** Schema version; 3 = keyed by session id; 2 was conversation-keyed; 1 raw ids. */
  version: number;
  /**
   * The app version that last wrote this file.
   * Empty for a file written before this was tracked.
   * Distinct from `version`, which describes the SHAPE of the data: this one says which build touched it, which is what makes a rollback detectable and a backup worth stamping.
   */
  appVersion: string;
  /**
   * Keys this build does not recognise, kept verbatim and written back untouched.
   *
   * `normalize` rebuilds the object from the keys it knows, so without this an older build opening a newer file would silently drop whatever the newer one added, the moment anything was changed.
   * That was harmless while one machine ran one build.
   * It stops being harmless once installed versions exist, where the build reading a file may be older than the one that wrote it.
   */
  extra: Record<string, unknown>;
}

/**
 * Every key `normalize` handles.
 * Anything else is preserved through `extra` rather than dropped.
 */
const KNOWN_KEYS = new Set([
  'pinned',
  'historyPins',
  'requestPins', // the pre-rename spelling of historyPins; read, never written
  'openSessions',
  'runningSessions',
  'pausedSessions', // the tabs you paused, before pause gave way to the set-aside mark; taken into `setAside` on each read until a write drops it, never written
  'scheduledWhenStopped',
  'activeSession',
  'activeSessionByProject',
  'finished',
  'archived', // the pre-rename spelling of finished; read, never written
  'activeProject',
  'activeFolder', // the pre-rename spelling of activeProject; read, never written
  'projectNames',
  'projectOrder',
  'footerExpanded', // a key of the live strip, which is gone; still listed so an old file's copy is consumed rather than preserved through `extra`
  'windowBounds',
  'ui',
  'settings',
  'moved',
  'notes',
  'needsYou',
  'needsYouHistory',
  'setAside',
  'later', // the pre-rename spelling of setAside; read, never written
  'kept',
  'prLinks',
  'prSeen',
  'groups',
  'groupOf',
  'version',
  'appVersion',
]);

function metaPath(): string {
  return path.join(app.getPath('userData'), 'meta.json');
}

function defaults(): Meta {
  return { pinned: [], historyPins: {}, openSessions: [], runningSessions: [], scheduledWhenStopped: {}, activeSession: null, activeSessionByProject: {}, finished: {}, activeProject: null, projectNames: {}, projectOrder: [], windowBounds: null, ui: defaultUi(), settings: normalizeSettings(undefined), moved: [], notes: {}, needsYou: {}, needsYouHistory: {}, setAside: {}, kept: {}, prLinks: {}, prSeen: null, groups: [], groupOf: {}, version: 3, appVersion: '', extra: {} };
}

/**
 * Fill in stored settings field by field, defaulting anything absent or of the wrong type — the same treatment `ui` gets, and for the same reason.
 * Applied on read and on write, so neither an older meta.json nor a renderer bug can produce a shape the launcher then has to guess at.
 */
function normalizeSettings(raw: unknown): MetaSettings {
  const base = { launchFlags: defaultSettings().launchFlags };
  if (!raw || typeof raw !== 'object') return base;
  const settings = raw as Record<string, unknown>;
  return {
    launchFlags: typeof settings.launchFlags === 'string' ? settings.launchFlags : base.launchFlags,
  };
}

/**
 * The layout tree's state, entry by entry: what is not the right shape is dropped, and the rest kept.
 * Only the containers are checked, not whether an id is still in the layout file — that file changes under the app, and the tree ignores state for an id it does not have.
 * The first slice's `{ width }` is not carried: it had one user and a week of life, and the tree starts that side from the file's size.
 */
function normalizePanelState(raw: unknown, px: (value: unknown) => number | null, strings: (value: unknown) => string[]): PanelState {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const state = record(raw);
  const sizes: PanelState['sizes'] = {};
  for (const [split, children] of Object.entries(record(state.sizes))) {
    const kept = Object.entries(record(children)).flatMap(([child, size]) => {
      const value = px(size);
      return value === null ? [] : [[child, value] as const];
    });
    if (kept.length > 0) sizes[split] = Object.fromEntries(kept);
  }
  const active = Object.fromEntries(Object.entries(record(state.active)).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  return { sizes, collapsed: strings(state.collapsed), active };
}

/** The filters stored under another key before their word changed: `live` as `running`, `setAside` as `later`, `finished` as `archived`. */
const FILTERS_BEFORE: Partial<Record<keyof UiState['filters'], string>> = { live: 'running', setAside: 'later', finished: 'archived' };

/**
 * Fill in a stored UiState field by field, defaulting anything absent or of the wrong type.
 *
 * Applied on READ and on WRITE, deliberately.
 * On read it means a meta.json from before this existed, or one a newer build wrote with fields this one has never heard of, still produces a usable sidebar.
 * On write it means the renderer cannot put something in the file that the next launch would choke on — this is the one structure the UI hands over wholesale rather than a value at a time.
 */
function normalizeUi(raw: unknown): UiState {
  const base = defaultUi();
  if (!raw || typeof raw !== 'object') return base;
  const ui = raw as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  // A width of 0 would collapse a pane to nothing with no way to drag it back, so anything non-positive is treated as "never set" and takes the default.
  const px = (value: unknown): number | null => (typeof value === 'number' && value > 0 ? value : null);
  const filters = (ui.filters ?? {}) as Record<string, unknown>;
  return {
    search: typeof ui.search === 'string' ? ui.search : base.search,
    filters: Object.fromEntries(
      // A key the file does not have takes its default, so a filter added later reads as it would on a first run, and one that is gone, such as `paused`, is dropped.
      // A filter whose word changed reads its old key as its fallback, so an existing file keeps the toggle rather than silently clearing it.
      (Object.keys(base.filters) as (keyof UiState['filters'])[]).map((key) => {
        const old = FILTERS_BEFORE[key];
        return [key, bool(filters[key], old === undefined ? base.filters[key] : bool(filters[old], base.filters[key]))];
      }),
    ) as UiState['filters'],
    datePreset: typeof ui.datePreset === 'string' ? ui.datePreset : base.datePreset,
    dateFrom: ms(ui.dateFrom),
    dateTo: ms(ui.dateTo),
    filterPanelOpen: bool(ui.filterPanelOpen, base.filterPanelOpen),
    tabBarExpanded: bool(ui.tabBarExpanded, base.tabBarExpanded),
    collapsedProjects: strings(ui.collapsedProjects),
    collapsedGroups: strings(ui.collapsedGroups),
    filterCollapsedProjects: strings(ui.filterCollapsedProjects),
    filterCollapsedGroups: strings(ui.filterCollapsedGroups),
    sidebarWidth: px(ui.sidebarWidth),
    scrollTop: typeof ui.scrollTop === 'number' && Number.isFinite(ui.scrollTop) ? Math.max(0, ui.scrollTop) : 0,
    panelState: normalizePanelState(ui.panelState, px, strings),
  };
}

/**
 * The stored history pins, each kept only whole: a pin missing its session or its text is nothing a list could show.
 * One without a kind is a request's, which is all a pin could be before claude's messages could be pinned.
 */
function normalizeHistoryPins(raw: unknown): Record<string, HistoryPin> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const pins: Record<string, HistoryPin> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const pin = value as Record<string, unknown>;
    if (typeof pin.session !== 'string' || typeof pin.text !== 'string' || typeof pin.time !== 'string') continue;
    pins[id] = {
      kind: pin.kind === 'reply' ? 'reply' : 'request',
      session: pin.session,
      text: pin.text,
      time: pin.time,
      pinnedAt: typeof pin.pinnedAt === 'number' && Number.isFinite(pin.pinnedAt) ? pin.pinnedAt : 0,
    };
  }
  return pins;
}

/**
 * Stored window bounds, or null if there is nothing trustworthy there.
 * All four numbers are required together, because a partial rectangle is not a position — half of one would place the window somewhere nobody asked for.
 * `Number.isFinite` rather than a `typeof` check: JSON can hold `null`, and a NaN or Infinity that reached the file would come back out as an unopenable window rather than as an error.
 */
function parseBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const numbers = ['x', 'y', 'width', 'height'].map((key) => b[key]);
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, width, height] = numbers as [number, number, number, number];
  // A zero or negative size is damage, not a preference.
  // Placement handles a size that is merely too SMALL by clamping it; this rejects the ones that are not sizes at all.
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, maximized: b.maximized === true };
}

// Coerce a parsed blob into a well-formed Meta, tolerating older shapes (throws on non-object input).
function normalize(parsed: Record<string, unknown>): Meta {
  // `activeProject` was written as `activeFolder` before the project/folder terminology split; read the old key so an existing meta.json keeps its scope.
  // The next write stores the new name.
  const rawActive = parsed.activeProject ?? parsed.activeFolder;
  // `archived` is what the finished sessions were stored as before the act was called Finished, read, never written; the next write stores the new name.
  // It was once a plain id list; migrate that to the id->timestamp map (0 = unknown).
  const rawFinished = parsed.finished ?? parsed.archived;
  let finished: Record<string, number> = {};
  if (Array.isArray(rawFinished)) {
    for (const id of rawFinished) if (typeof id === 'string') finished[id] = 0;
  } else if (rawFinished && typeof rawFinished === 'object') {
    finished = rawFinished as Record<string, number>;
  }
  // Drop malformed group entries, then any membership naming a group that no longer exists, so a hand-edited or half-written file can't leave a session pointing at nothing.
  const groups = Array.isArray(parsed.groups)
    ? (parsed.groups as unknown[]).filter((raw): raw is SessionGroup => {
        if (!raw || typeof raw !== 'object') return false;
        const g = raw as Record<string, unknown>;
        return typeof g.id === 'string' && typeof g.name === 'string' && (typeof g.repoRoot === 'string' || g.repoRoot === null);
      })
    : [];
  const ids = new Set(groups.map((g) => g.id));
  const groupOf: Record<string, string> = {};
  if (parsed.groupOf && typeof parsed.groupOf === 'object') {
    for (const [sessionId, groupId] of Object.entries(parsed.groupOf as Record<string, unknown>)) {
      if (typeof groupId === 'string' && ids.has(groupId)) groupOf[sessionId] = groupId;
    }
  }
  return {
    pinned: Array.isArray(parsed.pinned) ? (parsed.pinned as string[]) : [],
    // Same reasoning as projectOrder: no version bump for a new defaulted field.
    // `requestPins` is what the pins were stored as before a reply could be pinned; read, never written.
    historyPins: normalizeHistoryPins(parsed.historyPins ?? parsed.requestPins),
    openSessions: Array.isArray(parsed.openSessions) ? (parsed.openSessions as string[]) : [],
    // Same reasoning as projectOrder below: no version bump for a new defaulted field; absent means nothing was running.
    // A tab a file from before the set-aside mark lists as paused as well was one whose pause still waited for claude to leave, which pause never started or marked at launch, so it is not taken as running either.
    runningSessions: Array.isArray(parsed.runningSessions) ? (parsed.runningSessions as unknown[]).filter((id): id is string => typeof id === 'string' && !(Array.isArray(parsed.pausedSessions) && parsed.pausedSessions.includes(id))) : [],
    // The same again: absent means no stopped tab had a cron scheduled.
    scheduledWhenStopped: scheduledBySession(parsed.scheduledWhenStopped),
    // Same reasoning as projectOrder below: a new defaulted field is not a reinterpretation of what is stored, so no version bump.
    // Absent means "no memory yet" — open on nothing.
    activeSession: typeof parsed.activeSession === 'string' ? parsed.activeSession : null,
    activeSessionByProject: Object.fromEntries(
      Object.entries((parsed.activeSessionByProject ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    finished,
    activeProject: typeof rawActive === 'string' ? rawActive : null,
    projectNames:
      parsed.projectNames && typeof parsed.projectNames === 'object'
        ? (parsed.projectNames as Record<string, string>)
        : {},
    // No version bump for this one: `version` tracks how ids are KEYED, and adding a field is not a reinterpretation of anything already stored — a meta.json without it simply starts unseeded.
    projectOrder: Array.isArray(parsed.projectOrder)
      ? (parsed.projectOrder as unknown[]).filter((r): r is string => typeof r === 'string')
      : [],
    // Absent (an older meta.json) means the preference was never expressed, so take the new default rather than the old hard-coded "closed".
    // Absent for anything written before the window remembered itself, which simply means "open at the default size".
    windowBounds: parseBounds(parsed.windowBounds),
    ui: normalizeUi(parsed.ui),
    // Same reasoning as projectOrder: a new defaulted field is not a reinterpretation of what is stored, so no version bump.
    // Absent means nothing was ever chosen.
    settings: normalizeSettings(parsed.settings),
    // Same reasoning as projectOrder: no version bump for a new defaulted field; absent means nothing has moved yet.
    moved: Array.isArray(parsed.moved) ? (parsed.moved as unknown[]).filter((name): name is string => typeof name === 'string') : [],
    // Same reasoning as projectOrder: no version bump for a new defaulted field.
    // Non-string values are dropped so a hand-edited file can't put an object where a note should be.
    notes: Object.fromEntries(
      Object.entries((parsed.notes ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    // Same reasoning as projectOrder: no version bump for a new defaulted field; absent means nothing is marked.
    // An entry this build cannot read is dropped, so a hand edit can't leave a mark with no reason to show.
    needsYou: needsYouOf(parsed.needsYou),
    // The same again: absent means nothing settled yet; an entry this build cannot read is dropped.
    needsYouHistory: needsYouHistoryOf(parsed.needsYouHistory),
    // The same again: absent means nothing is set aside; `later` is what the marks were stored as before the act was called Set aside, read, never written.
    // A file from before pause gave way to the set-aside mark lists the tabs you paused, each of them set aside here, whenever (decided 2026-10-29), so nothing set aside is lost.
    setAside: setAsideWithPaused(setAsideOf(parsed.setAside ?? parsed.later), parsed.pausedSessions, Date.now()),
    // The same again: absent means nothing kept out of the review; a stamp that is no moment is dropped.
    kept: Object.fromEntries(Object.entries((parsed.kept ?? {}) as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))),
    // The same again: absent means no session linked; a link is read back from its page, so one that is no GitHub pull request page is dropped.
    prLinks: prLinksOf(parsed.prLinks),
    // The same again: absent means never kept, the first run.
    prSeen: prSeenOf(parsed.prSeen),
    groups,
    groupOf,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : '',
    // Anything a newer build wrote that this one has never heard of.
    // Carried through untouched; nothing here is ever read.
    extra: Object.fromEntries(Object.entries(parsed).filter(([key]) => !KNOWN_KEYS.has(key))),
  };
}

// The last known-good copy, kept by writeMeta before each overwrite so a corrupt main file can be recovered instead of silently reset.
// Returns null when there's no usable backup.
async function readBackup(): Promise<Meta | null> {
  try {
    return normalize(JSON.parse(await fs.readFile(goodCopy(metaPath()), 'utf8')) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function readMeta(): Promise<Meta> {
  let raw: string;
  try {
    raw = await fs.readFile(metaPath(), 'utf8');
  } catch (error) {
    // No file yet (first run) or it was moved aside: prefer the last good backup, else defaults.
    const recovered = await readBackup();
    // A first run — no file and no backup — is not news.
    // Anything else is where "my pins and tabs are gone" starts, so it says which copy the app went on with.
    const failure = fsFailure(error);
    if (failure || recovered) {
      logOnce('warn', 'meta', `${metaPath()} ${failure ? `unreadable: ${failure}` : 'is missing'}, ${recovered ? 'using the backup' : 'starting from defaults'}`);
    }
    return recovered ?? defaults();
  }
  try {
    return normalize(JSON.parse(raw) as Record<string, unknown>);
  } catch (error) {
    // The file exists but won't parse (e.g. a write truncated by a crash).
    // Preserve it for recovery rather than silently resetting, then fall back to the last good backup before defaults.
    const kept = `${metaPath()}.corrupt-${Date.now()}.json`;
    let keptLine = `kept as ${path.basename(kept)}`;
    try {
      await fs.writeFile(kept, raw);
    } catch (keepError) {
      // Best-effort: if we can't preserve it, still recover below.
      keptLine = `could not be kept: ${errorText(keepError)}`;
    }
    const recovered = await readBackup();
    log('error', 'meta', `${metaPath()} does not parse (${errorText(error)}), ${keptLine}, ${recovered ? 'recovered from the backup' : 'starting from defaults'}`);
    return recovered ?? defaults();
  }
}

/**
 * Compare two `major.minor.patch` strings.
 * Returns <0, 0 or >0 like a sort comparator, and treats a missing or unparseable part as 0 — enough to tell an upgrade from a downgrade, which is all this is for.
 * Deliberately not a full semver implementation: pre-release tags sort as equal here, and the only cost of that is a slightly less precise log line.
 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  }
  return 0;
}

/** The audit log's line for a version change, the moment its copy is taken (`writeWithBackups`). */
async function stampVersionChange(storedVersion: string, current: string): Promise<void> {
  const direction = compareVersions(current, storedVersion) < 0 ? 'DOWNGRADE' : 'upgrade';
  await appendStamped(auditPath(), `===== ${direction} ${storedVersion} -> ${current} =====`);
}

async function writeMeta(meta: Meta): Promise<void> {
  try {
    await writeMetaFile(meta);
  } catch (error) {
    // Rejected to the caller as before, and said here too: the window only learns that one action failed, not that nothing it changes is being kept.
    log('error', 'meta', `${metaPath()} not saved: ${errorText(error)}`);
    throw error;
  }
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

async function writeMetaFile(meta: Meta): Promise<void> {
  const file = metaPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // The copies sit beside meta.json: `meta.json.bak` is the recovery point readMeta falls back to, and `meta.json.0.1.0.bak` the file as 0.1.0 left it.
  // The version copy needs no "have I already done it" flag: setting `appVersion` here makes the stored version match the running one, so every later write finds no change.
  const outgoing = meta.appVersion;
  const current = app.getVersion();
  meta.appVersion = current;
  // `extra` is a container for keys this build does not know, not a key of its own: spread its contents back alongside the known ones.
  // Known keys are written second so they always win, though by construction the two sets cannot overlap.
  const { extra, ...known } = meta;
  // Atomic, so a crash mid-write leaves the live meta.json intact; the queue below is what keeps two writes from sharing the temp file.
  await writeWithBackups(file, JSON.stringify({ ...extra, ...known, needsYou: storedNeedsYou(known.needsYou) }, null, 2), { at: file, isGood: isJson, outgoing, current, onVersionChange: () => stampVersionChange(outgoing, current) });
}

// Serialize every meta operation, through main's one queue per file (`inTurn`), the audit log's appends among them.
// Each op is a read-modify-write; run concurrently they interleave (readMeta then writeMeta, all async) and a stale write can land last and win — which silently drops tab-list changes when several fire close together (restore opening tabs + user open/close).
// The queue makes each op run to completion before the next starts, so the last logical change wins.
function serialize<T>(op: () => Promise<T>): Promise<T> {
  return inTurn(metaPath(), op);
}

// One line per meta write, appended to meta-audit.log, so a lost tab list or a dropped pin can be traced to the operation and the moment that wrote it.
// Written as a temporary aid for one bug; kept deliberately now the app is distributed, because "my tabs disappeared" is exactly the report you cannot reproduce on someone else's machine, and this is the only record of what actually happened.
// Best-effort throughout: logging must never break a real write.
let auditSeq = 0;
function auditPath(): string {
  return path.join(app.getPath('userData'), 'meta-audit.log');
}
/**
 * Append one stamped line and keep the file bounded.
 * Separate from `auditWrite` so something worth recording that is NOT a meta write — a lineage event — costs an append rather than a pointless rewrite of meta.json.
 */
async function appendAudit(text: string): Promise<void> {
  try {
    await appendStamped(auditPath(), `#${(auditSeq += 1)} ${text}`);
    await trimAudit();
  } catch (error) {
    // Never allowed to break a real write, but a gap in the audit log is worth knowing about when that log is what someone is reading.
    logOnce('warn', 'meta', `${auditPath()} not written: ${errorText(error)}`);
  }
}

async function auditWrite(op: string, meta: Meta): Promise<void> {
  await appendAudit(`${op} open=${JSON.stringify(meta.openSessions)} running=${JSON.stringify(meta.runningSessions)} pinned=${JSON.stringify(meta.pinned)}`);
}

// At the ~150 bytes a typical line costs, this keeps on the order of a thousand writes: enough to read back through several sessions of work.
// Trimming to HALF the cap, rather than just under it, keeps the rewrite occasional instead of firing on every subsequent write.
const AUDIT_MAX_BYTES = 256 * 1024;
const AUDIT_KEEP_BYTES = 128 * 1024;

/**
 * Bound the log by SIZE.
 * It used to be trimmed only when a STARTUP marker was written, which tied a file's growth to a debug marker elsewhere — so removing that marker left the log growing forever, and left the trim unable to fire anyway, since it looked for STARTUP lines that no longer existed.
 * Size is the property actually being bounded, so bound that directly, in bytes rather than lines: a line-count trim does not bound a file whose lines can be any length, and `openSessions` grows with the number of open tabs.
 * Runs inside the same serialize() as the write it follows, so a trim can never race an append.
 */
async function trimAudit(): Promise<void> {
  const { size } = await fs.stat(auditPath()).catch(() => ({ size: 0 }));
  if (size <= AUDIT_MAX_BYTES) return;
  const tail = (await fs.readFile(auditPath())).subarray(-AUDIT_KEEP_BYTES);
  // The cut lands mid-line, so drop that partial record and start on a whole one.
  // No newline at all means the tail is one oversized line with no complete record in it: keep none of it.
  const firstBreak = tail.indexOf(0x0a);
  await fs.writeFile(auditPath(), firstBreak === -1 ? Buffer.alloc(0) : tail.subarray(firstBreak + 1));
}

// Read-modify-write the meta as one atomic step in the queue.
// `mutate` returns the value to resolve.
function update<T>(op: string, mutate: (meta: Meta) => T): Promise<T> {
  return serialize(async () => {
    const meta = await readMeta();
    const result = mutate(meta);
    await writeMeta(meta);
    await auditWrite(op, meta);
    return result;
  });
}

/**
 * One-time upgrade of pins/open-tabs/finished to SESSION ids, from conversation keys (v2) or raw ids (v1).
 * Any key that matches a session's conversationId is rewritten to that session's id (for a multi-file family: its latest member — the row the old model showed); id keys and keys naming a session no longer on disk pass through unchanged, which also makes a v1 file migrate correctly.
 */
export function migrateToSessionKeys(conversationToId: Map<string, string>): Promise<void> {
  return serialize(async () => {
    const meta = await readMeta();
    if (meta.version >= 3) return;
    const remapKey = (k: string): string => conversationToId.get(k) ?? k;
    meta.pinned = [...new Set(meta.pinned.map(remapKey))];
    meta.openSessions = [...new Set(meta.openSessions.map(remapKey))];
    if (meta.activeSession) meta.activeSession = remapKey(meta.activeSession);
    meta.activeSessionByProject = Object.fromEntries(
      Object.entries(meta.activeSessionByProject).map(([root, key]) => [root, remapKey(key)]),
    );
    meta.finished = Object.fromEntries(Object.entries(meta.finished).map(([k, ts]) => [remapKey(k), ts]));
    meta.version = 3;
    await writeMeta(meta);
    await auditWrite('migrate', meta);
  });
}

export function getPinned(): Promise<string[]> {
  return serialize(async () => (await readMeta()).pinned);
}

export function togglePin(id: string): Promise<string[]> {
  return update('togglePin', (meta) => {
    meta.pinned = togglePinned(meta.pinned, id);
    return meta.pinned;
  });
}

/** How much of what was pinned a pin keeps: enough to recognise it in a list of pins, and a pin stays a few hundred bytes. */
const HISTORY_PIN_TEXT = 300;

export function getHistoryPins(): Promise<Record<string, HistoryPin>> {
  return serialize(async () => (await readMeta()).historyPins);
}

/**
 * Pin request or message `id` with what a list of pins shows of it, or unpin it if it is pinned.
 * The pin arrives from the window, so a malformed one is refused here, the same way a malformed stored one is dropped on read.
 */
export function toggleHistoryPin(id: string, pin: Pick<HistoryPin, 'kind' | 'session' | 'text' | 'time'>): Promise<Record<string, HistoryPin>> {
  // Typed as what the window should send; checked as what it might.
  const given = pin as Partial<Record<keyof typeof pin, unknown>> | undefined;
  return update('toggleHistoryPin', (meta) => {
    if (id in meta.historyPins) {
      delete meta.historyPins[id];
    } else if (id && (given?.kind === 'request' || given?.kind === 'reply') && typeof given.session === 'string' && typeof given.text === 'string' && typeof given.time === 'string') {
      meta.historyPins[id] = { kind: given.kind, session: given.session, text: given.text.slice(0, HISTORY_PIN_TEXT), time: given.time, pinnedAt: Date.now() };
    }
    return meta.historyPins;
  });
}

export function getFinished(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).finished);
}

/** Mark sessions finished, in one write, which settles anything each needed you for, and what you set it aside for: a finished session is put away. */
export function finish(ids: string[]): Promise<Record<string, number>> {
  return update('finish', (meta) => {
    const now = Date.now();
    for (const id of ids) {
      meta.finished = finishedFrom(meta.finished, id, now);
      Object.assign(meta, settledNeedsYou(meta, id, 'finished', now));
      meta.setAside = clearedSetAside(meta.setAside, id);
    }
    return meta.finished;
  });
}

/** Make sessions unfinished, in one write. */
export function unfinish(ids: string[]): Promise<Record<string, number>> {
  return update('unfinish', (meta) => {
    for (const id of ids) meta.finished = clearedFinished(meta.finished, id);
    return meta.finished;
  });
}

/**
 * Drop a session from all metadata (used when it is deleted), by the rule the window's checks answer with too (`purgedSession`, src/shared/sessionmarks.ts).
 * History pins stay: they are keyed by the request or message, which a fork sibling may still carry, and telling which pins nothing opens any more needs every transcript read — a job for a list of every pin, not for a delete.
 */
export function purgeSession(id: string): Promise<void> {
  return update('purgeSession', (meta) => {
    Object.assign(meta, purgedSession(meta, id));
  });
}

/**
 * Record that `/clear` replaced session `from` with session `to`, which Claude Code started under a copy of `from`'s name.
 *
 * DATA COLLECTION, deliberately and only.
 * Nothing reads it back, and the app's behaviour does not depend on it.
 * It is here because the pairing is observable exactly once, in this app and nowhere else — nothing in either transcript links the two sessions, and the connection is gone the moment the event passes.
 * Whether a cleared session should be presented as related to its predecessor is an open question; this is the record that will let it be answered from what happened rather than guessed.
 */
export function recordClear(from: string, to: string, title: string): Promise<void> {
  return serialize(() => appendAudit(`clear ${from} -> ${to}${title ? ` title=${JSON.stringify(title)}` : ''}`));
}

export function getOpenSessions(): Promise<string[]> {
  return serialize(async () => (await readMeta()).openSessions);
}

/** The sessions that were running when the open tabs were last written; see `runningSessions`. */
export function getRunningSessions(): Promise<string[]> {
  return serialize(async () => (await readMeta()).runningSessions);
}

/** The crons the open tabs whose claude went had scheduled; see `scheduledWhenStopped`. */
export function getScheduledWhenStopped(): Promise<Record<string, ScheduledTask[]>> {
  return serialize(async () => (await readMeta()).scheduledWhenStopped);
}

/** Keep the crons the open tabs whose claude went had scheduled, each read as claude's own list is read (`scheduledTasksOf`), for the open sessions only. */
export function setScheduledWhenStopped(bySession: Record<string, unknown>): Promise<void> {
  return update('setScheduledWhenStopped', (meta) => {
    meta.scheduledWhenStopped = Object.fromEntries(Object.entries(scheduledBySession(bySession)).filter(([id]) => meta.openSessions.includes(id)));
  });
}

/** The sessions marked as needing you; see `needsYou`. */
export function getNeedsYou(): Promise<Record<string, NeedsYou[]>> {
  return serialize(async () => (await readMeta()).needsYou);
}

/** Mark sessions as needing you for `reasons`, each beside a session's other reasons and replacing one of its kind, which goes to its history (`markedWithHistory`). */
export function markNeedsYou(ids: string[], reasons: NeedsYou[]): Promise<void> {
  return update('markNeedsYou', (meta) => {
    Object.assign(meta, markedWithHistory(meta, ids, reasons, Date.now()));
  });
}

/** Take a session's needs-you mark off, whether or not it had one, its reasons going to its history as settled by `by` (`settledNeedsYou`). */
export function clearNeedsYou(id: string, by: SettledBy): Promise<void> {
  return update('clearNeedsYou', (meta) => {
    Object.assign(meta, settledNeedsYou(meta, id, by, Date.now()));
  });
}

/** Put a session's reasons back as they were, as Undo of a close or a finish does, and take them back off its history (`restoredNeedsYou`). */
export function restoreNeedsYou(id: string, reasons: NeedsYou[]): Promise<void> {
  return update('restoreNeedsYou', (meta) => {
    Object.assign(meta, restoredNeedsYou(meta, id, reasons));
  });
}

/** Take every session's reasons of `types` off, each into its history as settled `off` (`settledTypes`): the types were switched off. */
export function settleNeedsYouTypes(types: string[]): Promise<void> {
  return update('settleNeedsYouTypes', (meta) => {
    Object.assign(meta, settledTypes(meta, types, Date.now()));
  });
}

/** Each session's history of settled reasons; see `needsYouHistory`. */
export function getNeedsYouHistory(): Promise<Record<string, SettledNeedsYou[]>> {
  return serialize(async () => (await readMeta()).needsYouHistory);
}

const CLOSED_HOWS: readonly ClosedHow[] = ['quit', 'ended', 'unknown'];

/** A PR's change in its older words, as its type. */
const PR_TYPE_OF = new Map(Object.entries(PR_TYPES).map(([type, change]) => [change, type as PrNeedsYouType]));

/**
 * One stored reason as the reasons it reads as, none for one this build cannot read: by its type, or in the older form from before reasons had types, where how the app closed was the reason itself and a PR's changes were one reason holding them all, one reason per change now (decided 2026-11-06).
 * A type this build does not fire, a reason without a time, a PR's without the PR, and an older PR reason with a change this build does not know are left out.
 */
function reasonsOf(item: unknown): NeedsYou[] {
  if (typeof item !== 'object' || item === null) return [];
  const { type, reason, at, pr, how, changes } = item as Record<string, unknown>;
  if (typeof at !== 'number') return [];
  if (type !== undefined) {
    if (type === 'app.reminder') return [{ type, at }];
    if (type === 'app.was-running') return CLOSED_HOWS.includes(how as ClosedHow) ? [{ type, at, how: how as ClosedHow }] : [];
    return typeof type === 'string' && isPrType(type) && typeof pr === 'string' ? [{ type, at, pr }] : [];
  }
  if (CLOSED_HOWS.includes(reason as ClosedHow)) return [{ type: 'app.was-running', at, how: reason as ClosedHow }];
  if (reason === 'reminder') return [{ type: 'app.reminder', at }];
  if (reason !== 'pr' || typeof pr !== 'string' || !Array.isArray(changes) || changes.length === 0) return [];
  const types = changes.map((change) => PR_TYPE_OF.get(change as PrChange));
  return types.every((t) => t !== undefined) ? types.map((t) => ({ type: t, at, pr })) : [];
}

/**
 * Session -> every reason it needs you for, from whatever was stored (`reasonsOf`), a session left with none dropped.
 * A single reason, as a file from before a session kept every reason holds it, is read as a list of one.
 */
function needsYouOf(raw: unknown): Record<string, NeedsYou[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      const reasons = (Array.isArray(entry) ? entry : [entry]).flatMap(reasonsOf);
      return reasons.length > 0 ? [[id, reasons]] : [];
    }),
  );
}

const SETTLED_BY: readonly SettledBy[] = ['prompt', 'cleared', 'closed', 'moved', 'finished', 'replaced', 'off'];

/** Session -> its settled reasons, from whatever was stored: an entry whose reason does not read (`reasonsOf`), or without a moment it was settled or what settled it, left out, the newest `HISTORY_KEPT` kept, and a session left with none dropped. */
function needsYouHistoryOf(raw: unknown): Record<string, SettledNeedsYou[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      const settled = (Array.isArray(entry) ? entry : []).flatMap((item: unknown): SettledNeedsYou[] => {
        const reasons = reasonsOf(item);
        if (reasons.length !== 1) return [];
        const { settled: at, by } = item as Record<string, unknown>;
        return typeof at === 'number' && SETTLED_BY.includes(by as SettledBy) ? [{ ...reasons[0]!, settled: at, by: by as SettledBy }] : [];
      });
      return settled.length > 0 ? [[id, settled.slice(0, HISTORY_KEPT)]] : [];
    }),
  );
}

/**
 * The reasons as they are written: each with its older form beside its type, `reason` and for a PR's change `changes` holding its one change, which a build from before reasons had types reads as it always did, ignoring the type, so going back a build loses no mark (decided 2026-11-06).
 * Never read while the type is there; nothing released knows `needsYou`, so the next release drops it.
 */
function storedNeedsYou(needsYou: Record<string, NeedsYou[]>): Record<string, object[]> {
  const older = (reason: NeedsYou): object => {
    if (isPrReason(reason)) return { reason: 'pr', changes: [PR_TYPES[reason.type]] };
    return reason.type === 'app.was-running' ? { reason: reason.how } : { reason: 'reminder' };
  };
  return Object.fromEntries(Object.entries(needsYou).map(([id, reasons]) => [id, reasons.map((reason) => ({ ...reason, ...older(reason) }))]));
}

/** What was last seen of the PRs; see `prSeen`. */
export function getPrSeen(): Promise<PrSeen | null> {
  return serialize(async () => (await readMeta()).prSeen);
}

/** Keep what was last seen of the PRs, in place of what was kept before. */
export function setPrSeen(seen: PrSeen): Promise<void> {
  return update('setPrSeen', (meta) => {
    meta.prSeen = prSeenOf(seen) ?? {};
  });
}

/** What may stand in each part of an open PR's status, null among them (`PrStatus`). */
const PR_PARTS: Record<'review' | 'checks' | 'conflict', readonly unknown[]> = {
  review: ['approved', 'changes-requested', 'review-required', null],
  checks: ['passed', 'failed', 'running', null],
  conflict: [true, false, null],
};

/** A field a build before it did not store, read as null: not known. */
const unknownIfMissing = (value: unknown): unknown => (value === undefined ? null : value);

/** Whether a stored value is a field's value or null, by the check for its value. */
const valueOrNull = (value: unknown, check: (value: unknown) => boolean): boolean => value === null || check(value);

/**
 * A PR's status as it was stored, null for one this build cannot read.
 * A field a build before it did not store is read as not known, so a status kept then still reads.
 */
function prStatusOf(raw: unknown): PrStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const { state, draft, review, checks, conflict } = fields;
  const [role, approvals, newCommits, reviewAsked, changesRequested] = [fields.role, fields.approvals, fields.newCommits, fields.reviewAsked, fields.changesRequested].map(unknownIfMissing);
  if (!valueOrNull(role, (value) => PR_ROLES.includes(value as PrRole))) return null;
  if (state === 'merged' || state === 'closed') return { state, role: role as PrRole | null };
  if (state !== 'open' || typeof draft !== 'boolean' || !PR_PARTS.review.includes(review) || !PR_PARTS.checks.includes(checks) || !PR_PARTS.conflict.includes(conflict)) return null;
  const counts = valueOrNull(approvals, (value) => Number.isInteger(value) && (value as number) >= 0);
  const flags = [newCommits, reviewAsked].every((flag) => valueOrNull(flag, (value) => typeof value === 'boolean'));
  const ids = valueOrNull(changesRequested, (value) => Array.isArray(value) && value.every((id) => typeof id === 'string'));
  if (!counts || !flags || !ids) return null;
  return { state, role, draft, review, checks, conflict, approvals, newCommits, reviewAsked, changesRequested } as PrStatus;
}

/** The stored PR links, each read back from its page (`prFromUrl`), so one whose address is not shaped like a GitHub pull request page is dropped, and a session left with none with it. */
function prLinksOf(raw: unknown): Record<string, SessionPr[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const links: Record<string, SessionPr[]> = {};
  for (const [id, list] of Object.entries(raw)) {
    const prs = (Array.isArray(list) ? (list as unknown[]) : []).flatMap((each) => {
      const url = typeof each === 'object' && each !== null ? (each as { url?: unknown }).url : undefined;
      const pr = typeof url === 'string' ? prFromUrl(url) : null;
      return pr ? [pr] : [];
    });
    if (prs.length > 0) links[id] = prs;
  }
  return links;
}

/**
 * What was last seen of the PRs, from whatever was stored: null for none at all, and an entry this build cannot read dropped.
 * Each is read under its key (`referenceKey`), as the window keeps them, so one an earlier build kept under each of two spellings is read once, the first kept.
 */
function prSeenOf(raw: unknown): PrSeen | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const seen: PrSeen = {};
  for (const [ref, entry] of Object.entries(raw as Record<string, unknown>)) {
    const status = prStatusOf(entry);
    const key = referenceKey(ref);
    if (status && !Object.hasOwn(seen, key)) seen[key] = status;
  }
  return seen;
}

/** The sessions set aside; see `setAside`. */
export function getSetAside(): Promise<Record<string, SetAside>> {
  return serialize(async () => (await readMeta()).setAside);
}

/** Set sessions aside, in one write, `due` the moment they come back, or null for whenever; a mark already there is replaced. */
export function markSetAside(ids: string[], due: number | null, at = Date.now()): Promise<void> {
  return update('markSetAside', (meta) => {
    for (const id of ids) meta.setAside = markedSetAside(meta.setAside, id, due, at);
  });
}

/** Take sessions' set-aside marks off, in one write, whether or not each had one. */
export function clearSetAside(ids: string[]): Promise<void> {
  return update('clearSetAside', (meta) => {
    for (const id of ids) meta.setAside = clearedSetAside(meta.setAside, id);
  });
}

/** The PRs the app linked each session to; see `prLinks`. */
export function getPrLinks(): Promise<Record<string, SessionPr[]>> {
  return serialize(async () => (await readMeta()).prLinks);
}

/** Link a session to the PR at `url`, by `withPrLink`'s rule. */
export function addPrLink(id: string, url: string): Promise<void> {
  return update('addPrLink', (meta) => {
    meta.prLinks = withPrLink(meta.prLinks, id, url);
  });
}

/** When each session was last kept out of the review; see `kept`. */
export function getKept(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).kept);
}

/** Keep sessions out of the review from `at`, in one write (`keptFrom`). */
export function keep(ids: string[], at = Date.now()): Promise<void> {
  return update('keep', (meta) => {
    meta.kept = keptFrom(meta.kept, ids, at);
  });
}

/** Take sessions' keep stamps off, in one write, as Keep's Undo does. */
export function unkeep(ids: string[]): Promise<void> {
  return update('unkeep', (meta) => {
    meta.kept = unkept(meta.kept, ids);
  });
}

/** Settle the set-aside marks that have come due by `now`, by the rule the window keeps its copy by (`cameDue`), marking a reminder while `remind` says its type is on. */
export function setAsideCameDue(now: number, remind = true): Promise<void> {
  return update('setAsideCameDue', (meta) => {
    Object.assign(meta, cameDue(meta, now, remind));
  });
}

/** Session -> its set-aside mark, from whatever was stored, an entry with a time left out or a day that is not a number dropped. */
function setAsideOf(raw: unknown): Record<string, SetAside> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).flatMap(([id, entry]) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const { due, at } = entry as Record<string, unknown>;
      return (due === null || typeof due === 'number') && typeof at === 'number' ? [[id, { due, at }]] : [];
    }),
  );
}

/**
 * The set-aside marks with each session an older file lists as paused (`pausedSessions`) added, whenever, from `at`; one marked already keeps its mark.
 * Read on every read until the next write drops the list, so `at` is that read's until a write keeps one.
 */
function setAsideWithPaused(setAside: Record<string, SetAside>, paused: unknown, at: number): Record<string, SetAside> {
  if (!Array.isArray(paused)) return setAside;
  const added = (paused as unknown[]).filter((id): id is string => typeof id === 'string' && !(id in setAside));
  return { ...setAside, ...Object.fromEntries(added.map((id) => [id, { due: null, at }])) };
}

/** Session -> its tasks, from whatever was stored, a session with none left out. */
function scheduledBySession(raw: unknown): Record<string, ScheduledTask[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .map(([id, list]) => [id, scheduledTasksOf(list)] as const)
      .filter(([, tasks]) => tasks.length > 0),
  );
}

/** The open tabs and which of them run, in one write, so the two lists are never from different moments. */
export function setOpenSessions(ids: string[], running: string[]): Promise<void> {
  return update('setOpenSessions', (meta) => {
    meta.openSessions = ids;
    // Only an open tab runs anything, or keeps what was scheduled when its claude went.
    meta.runningSessions = running.filter((id) => ids.includes(id));
    meta.scheduledWhenStopped = Object.fromEntries(Object.entries(meta.scheduledWhenStopped).filter(([id]) => ids.includes(id)));
    // A tab that is no longer open cannot be the one to reopen on — globally or for its project.
    if (meta.activeSession && !ids.includes(meta.activeSession)) meta.activeSession = null;
    meta.activeSessionByProject = Object.fromEntries(
      Object.entries(meta.activeSessionByProject).filter(([, id]) => ids.includes(id)),
    );
  });
}

export function getActiveSession(): Promise<string | null> {
  return serialize(async () => (await readMeta()).activeSession);
}

export function getActiveSessionByProject(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).activeSessionByProject);
}

/** Remember a session as the one to return to — overall, and within its own project. */
export function setActiveSession(id: string | null, repoRoot?: string): Promise<void> {
  return update('setActiveSession', (meta) => {
    meta.activeSession = id;
    if (id && repoRoot) meta.activeSessionByProject[repoRoot] = id;
  });
}

export function getActiveProject(): Promise<string | null> {
  return serialize(async () => (await readMeta()).activeProject);
}

export function setActiveProject(repoRoot: string | null): Promise<void> {
  return update('setActiveProject', (meta) => {
    meta.activeProject = repoRoot;
  });
}

export function getNotes(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).notes);
}

/**
 * Write a session's note, or clear it.
 * Blank (or whitespace-only) DELETES the entry rather than storing an empty string, so "has a note" stays a simple presence check and the row's mark can't linger over nothing.
 * Finishing keeps a note (it's still the same session); a fork inherits none, since it gets a new id and notes are keyed by id.
 */
export function setNote(id: string, note: string): Promise<Record<string, string>> {
  return update('setNote', (meta) => {
    meta.notes = withText(meta.notes, id, note);
    return meta.notes;
  });
}

export function getWindowBounds(): Promise<WindowBounds | null> {
  return serialize(async () => (await readMeta()).windowBounds);
}

/**
 * Remember where the window is.
 * Written through the same queue as everything else, so a resize landing at the same moment as a tab change cannot overwrite it — the reason this lives in meta.json at all rather than in a file of its own.
 */
export function setWindowBounds(bounds: WindowBounds): Promise<void> {
  return update('setWindowBounds', (meta) => {
    meta.windowBounds = bounds;
  });
}

export function getUiState(): Promise<UiState> {
  return serialize(async () => (await readMeta()).ui);
}

/**
 * Store the sidebar's view state.
 * Normalized on the way in, so a renderer bug cannot write a shape the next launch can't read.
 */
export function setUiState(state: UiState): Promise<void> {
  return update('setUiState', (meta) => {
    meta.ui = normalizeUi(state);
  });
}

/** The preferences as kept here before they moved into the config folder: read by that move (settings.ts), and by nothing else. */
export function getSettings(): Promise<MetaSettings> {
  return serialize(async () => (await readMeta()).settings);
}

/** What has moved from here into the config folder, by name (`launchFlags`), so each move is made once and a later reset of the app's file there does not bring the old value back. */
export function getMoved(): Promise<string[]> {
  return serialize(async () => (await readMeta()).moved);
}

/** Record that `name` has moved into the config folder; what it moved from stays where it was, so an older build still finds it. */
export function markMoved(name: string): Promise<void> {
  return update(`moved ${name}`, (meta) => {
    if (!meta.moved.includes(name)) meta.moved.push(name);
  });
}

export function getProjectNames(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).projectNames);
}

// Set a project's display-name override (blank clears it, reverting to the folder name).
export function setProjectName(repoRoot: string, name: string): Promise<Record<string, string>> {
  return update('setProjectName', (meta) => {
    meta.projectNames = withText(meta.projectNames, repoRoot, name);
    return meta.projectNames;
  });
}

// --- Session groups ------------------------------------------------------------------------- A group is a user-made sub-section inside one project.
// Membership is one group per session, so `groupOf` alone is the whole truth: a session cannot be in two groups by construction.
// Every mutation returns the WHOLE state, since the registry and the membership only make sense together.

function groupState(meta: Meta): GroupState {
  return { groups: meta.groups, groupOf: meta.groupOf };
}

export function getProjectOrder(): Promise<string[]> {
  return serialize(async () => (await readMeta()).projectOrder);
}

/**
 * Give every root a slot and return the order (`seededOrder`, src/shared/grouping.ts, which the window's checks answer with too).
 * An EMPTY order is seeded from `roots` exactly as given (the caller passes them in the order they already appear, so the run that introduced this changed nothing on screen); an existing order gets unknown roots at the FRONT, so a project that shows up later is somewhere you'll see it.
 * One rule: every root in front of an empty order is the roots as given.
 *
 * Absent roots are NOT pruned.
 * A root is absent once no listed session resolves to it, such as when its sessions were all deleted (finished ones are still listed: the caller seeds from the raw listing), and forgetting its slot would make it leap to the top when a session appears there again — the opposite of the stable order this exists to provide.
 */
export function seedProjectOrder(roots: string[]): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const seeded = seededOrder(meta.projectOrder, roots);
    if (!seeded) return meta.projectOrder; // nothing new: no write at all
    meta.projectOrder = seeded;
    await writeMeta(meta);
    await auditWrite('seedProjectOrder', meta);
    return meta.projectOrder;
  });
}

// Reorder one project among the ones on screen (`shown`, the window's to say); a move that goes nowhere writes nothing.
export function moveProject(repoRoot: string, move: OrderMove, shown: string[]): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const moved = movedProject(meta.projectOrder, repoRoot, move, shown);
    if (!moved) return meta.projectOrder;
    meta.projectOrder = moved;
    await writeMeta(meta);
    await auditWrite('moveProject', meta);
    return meta.projectOrder;
  });
}

export function getGroupState(): Promise<GroupState> {
  return serialize(async () => groupState(await readMeta()));
}

/** A group change applied: the rule's new state kept, and handed back. */
function setGroupState(meta: Meta, next: GroupState): GroupState {
  meta.groups = next.groups;
  meta.groupOf = next.groupOf;
  return groupState(meta);
}

// The rules for each change are in src/shared/grouping.ts.
export function createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState> {
  return update('createGroup', (meta) => setGroupState(meta, createdGroup(groupState(meta), randomUUID(), name, repoRoot, sessionId)));
}

export function renameGroup(id: string, name: string): Promise<GroupState> {
  return update('renameGroup', (meta) => setGroupState(meta, renamedGroup(groupState(meta), id, name)));
}

export function deleteGroup(id: string): Promise<GroupState> {
  return update('deleteGroup', (meta) => setGroupState(meta, withoutGroup(groupState(meta), id)));
}

export function moveGroup(id: string, move: OrderMove): Promise<GroupState> {
  return update('moveGroup', (meta) => setGroupState(meta, movedGroup(groupState(meta), id, move)));
}

/** Move sessions into a group, or out of any group with a null `groupId`, in one write. */
export function moveSessionsToGroup(sessionIds: string[], groupId: string | null): Promise<GroupState> {
  return update('moveSessionsToGroup', (meta) => setGroupState(meta, sessionIds.reduce((state, id) => withSessionInGroup(state, id, groupId), groupState(meta))));
}
