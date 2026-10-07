import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { OrderMove, GroupState, HistoryPin, SessionGroup, UiState, Settings } from '../shared/types';
import type { PanelState } from '../shared/panels';
import { defaultSettings, defaultUi } from '../shared/defaults';
import type { WindowBounds } from './bounds';
import { parseLaunchFlags } from '../shared/flags';
import { createdGroup, movedGroup, movedProject, renamedGroup, seededOrder, withoutGroup, withSessionInGroup } from '../shared/grouping';
import { purgedSession, togglePinned, toggleArchived } from '../shared/sessionmarks';
import { withText } from '../shared/text';
import { appendStamped } from './stamp';
import { goodCopy, writeWithBackups } from './backup';
import { errorText, fsFailure, log, logOnce } from './log';
import { inTurn } from './queue';

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
   * Which open session was last looked at, so a restart lands you where you left off.
   * Without it the app opened on whichever tab happened to be LAST in openSessions — harmless while every tab was started at launch, but tabs are restored COLD now, and landing on an arbitrary cold one is worse than landing on none.
   */
  activeSession: string | null;
  /**
   * repoRoot -> the session last looked at in THAT project, so switching back to a project returns you where you were.
   * The in-memory `activatedSeq` already does this within one run, but it resets to 0 on restore, which makes "most recent" meaningless exactly when you need it most.
   */
  activeSessionByProject: Record<string, string>;
  /** Archived session ids mapped to when they were archived (epoch ms; 0 = unknown). */
  archived: Record<string, number>;
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
   */
  settings: Settings;
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
  'activeSession',
  'activeSessionByProject',
  'archived',
  'activeProject',
  'activeFolder', // the pre-rename spelling of activeProject; read, never written
  'projectNames',
  'projectOrder',
  'footerExpanded', // moved into `ui`; still listed so an old file's copy is consumed rather than preserved through `extra`
  'windowBounds',
  'ui',
  'settings',
  'notes',
  'groups',
  'groupOf',
  'version',
  'appVersion',
]);

function metaPath(): string {
  return path.join(app.getPath('userData'), 'meta.json');
}

function defaults(): Meta {
  return { pinned: [], historyPins: {}, openSessions: [], activeSession: null, activeSessionByProject: {}, archived: {}, activeProject: null, projectNames: {}, projectOrder: [], windowBounds: null, ui: defaultUi(), settings: defaultSettings(), notes: {}, groups: [], groupOf: {}, version: 3, appVersion: '', extra: {} };
}

/**
 * Fill in stored settings field by field, defaulting anything absent or of the wrong type — the same treatment `ui` gets, and for the same reason.
 * Applied on read and on write, so neither an older meta.json nor a renderer bug can produce a shape the launcher then has to guess at.
 */
function normalizeSettings(raw: unknown): Settings {
  const base = defaultSettings();
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

/**
 * Fill in a stored UiState field by field, defaulting anything absent or of the wrong type.
 *
 * Applied on READ and on WRITE, deliberately.
 * On read it means a meta.json from before this existed, or one a newer build wrote with fields this one has never heard of, still produces a usable sidebar.
 * On write it means the renderer cannot put something in the file that the next launch would choke on — this is the one structure the UI hands over wholesale rather than a value at a time.
 */
function normalizeUi(raw: unknown, legacyFooterExpanded?: unknown): UiState {
  const base = defaultUi();
  // Even with no `ui` at all: an older file's live-strip setting is the one value in here worth carrying across.
  if (typeof legacyFooterExpanded === 'boolean') base.stripExpanded = legacyFooterExpanded;
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
      // `live` was stored as `running` before the word changed; read the old key as its fallback so an existing file keeps the toggle rather than silently clearing it.
      Object.keys(base.filters).map((key) => [key, bool(filters[key], key === 'live' ? filters.running === true : false)]),
    ) as UiState['filters'],
    datePreset: typeof ui.datePreset === 'string' ? ui.datePreset : base.datePreset,
    dateFrom: ms(ui.dateFrom),
    dateTo: ms(ui.dateTo),
    filterPanelOpen: bool(ui.filterPanelOpen, base.filterPanelOpen),
    // `stripExpanded` was stored as `footerExpanded` before the strip had one name; read the old key as its fallback so an existing file keeps the strip open or shut.
    stripExpanded: bool(ui.stripExpanded, bool(ui.footerExpanded, base.stripExpanded)),
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
  // `archived` was once a plain id list; migrate that to the id->timestamp map (0 = unknown).
  const rawArchived = parsed.archived;
  let archived: Record<string, number> = {};
  if (Array.isArray(rawArchived)) {
    for (const id of rawArchived) if (typeof id === 'string') archived[id] = 0;
  } else if (rawArchived && typeof rawArchived === 'object') {
    archived = rawArchived as Record<string, number>;
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
    // Same reasoning as projectOrder below: a new defaulted field is not a reinterpretation of what is stored, so no version bump.
    // Absent means "no memory yet" — open on nothing.
    activeSession: typeof parsed.activeSession === 'string' ? parsed.activeSession : null,
    activeSessionByProject: Object.fromEntries(
      Object.entries((parsed.activeSessionByProject ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    archived,
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
    // The strip's open state used to be a key of its own, so an existing file's value is handed in as the fallback: read once from there, written from here on.
    ui: normalizeUi(parsed.ui, parsed.footerExpanded),
    // Same reasoning as projectOrder: a new defaulted field is not a reinterpretation of what is stored, so no version bump.
    // Absent means nothing was ever chosen.
    settings: normalizeSettings(parsed.settings),
    // Same reasoning as projectOrder: no version bump for a new defaulted field.
    // Non-string values are dropped so a hand-edited file can't put an object where a note should be.
    notes: Object.fromEntries(
      Object.entries((parsed.notes ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
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
  await writeWithBackups(file, JSON.stringify({ ...extra, ...known }, null, 2), { at: file, isGood: isJson, outgoing, current, onVersionChange: () => stampVersionChange(outgoing, current) });
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
  await appendAudit(`${op} open=${JSON.stringify(meta.openSessions)} pinned=${JSON.stringify(meta.pinned)}`);
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
 * One-time upgrade of pins/open-tabs/archived to SESSION ids, from conversation keys (v2) or raw ids (v1).
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
    meta.archived = Object.fromEntries(Object.entries(meta.archived).map(([k, ts]) => [remapKey(k), ts]));
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

export function getArchived(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).archived);
}

export function toggleArchive(id: string): Promise<Record<string, number>> {
  return update('toggleArchive', (meta) => {
    meta.archived = toggleArchived(meta.archived, id, Date.now());
    return meta.archived;
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

export function setOpenSessions(ids: string[]): Promise<void> {
  return update('setOpenSessions', (meta) => {
    meta.openSessions = ids;
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
 * Archiving keeps a note (it's still the same session); a fork inherits none, since it gets a new id and notes are keyed by id.
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

export function getSettings(): Promise<Settings> {
  return serialize(async () => (await readMeta()).settings);
}

/**
 * Store the app's preferences, and resolve to what is actually stored.
 *
 * Unusable launch flags are refused rather than written: the dialog validates before it saves, but this is the side that hands the flags to a real session, so it does not take the renderer's word for it.
 * Refusing leaves the previous value in place, which is why the stored settings come back — the caller can see that its write did not take.
 */
export function setSettings(settings: Settings): Promise<Settings> {
  return update('setSettings', (meta) => {
    const next = normalizeSettings(settings);
    if (parseLaunchFlags(next.launchFlags).error === null) meta.settings = next;
    return meta.settings;
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
 * A project whose sessions are all archived drops out of the list while still existing, and forgetting its slot would make it leap to the top when a session comes back — the opposite of the stable order this exists to provide.
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

// Reorder one project among the others; a move that goes nowhere writes nothing.
export function moveProject(repoRoot: string, move: OrderMove): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const moved = movedProject(meta.projectOrder, repoRoot, move);
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

export function moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState> {
  return update('moveSessionToGroup', (meta) => setGroupState(meta, withSessionInGroup(groupState(meta), sessionId, groupId)));
}
