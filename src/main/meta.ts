import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { OrderMove, GroupState, SessionGroup, UiState, Settings } from '../shared/types';
import type { PanelState } from '../shared/panels';
import type { WindowBounds } from './bounds';
import { parseLaunchFlags } from '../shared/flags';

/**
 * UI-only metadata, kept outside ~/.claude so we never touch the session store.
 * `pinned` and `openSessions` hold session ids (the .jsonl file ids).
 * Session ids are immutable, unlike the conversation keys of v2, which stopped matching their session the moment it gained a sibling (the row then keys by its own id) — silently losing tabs and pins.
 */
interface Meta {
  pinned: string[];
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
  /** repoRoots in display order. Empty means "never seeded"; the first seed fills it from recency. */
  projectOrder: string[];
  /** Free-text note per session id. An empty note is deleted, so presence here means there IS one. */
  notes: Record<string, string>;
  /**
   * Size and position of the window as it was last left, or null until it has been.
   * The size stored is always the unmaximized one, with `maximized` recorded beside it, so restoring a maximized window still knows how big to make it when it is un-maximized.
   */
  windowBounds: WindowBounds | null;
  /** How the sidebar was left: search, filters, folds, width, scroll. See UiState. */
  ui: UiState;
  /** Deliberate preferences, kept apart from `ui` so resetting one cannot wipe the other. See Settings. */
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

/** Every key `normalize` handles. Anything else is preserved through `extra` rather than dropped. */
const KNOWN_KEYS = new Set([
  'pinned',
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
  return { pinned: [], openSessions: [], activeSession: null, activeSessionByProject: {}, archived: {}, activeProject: null, projectNames: {}, projectOrder: [], windowBounds: null, ui: defaultUi(), settings: defaultSettings(), notes: {}, groups: [], groupOf: {}, version: 3, appVersion: '', extra: {} };
}

/** What the app does before anyone has chosen otherwise: nothing added to the launch line. */
function defaultSettings(): Settings {
  return { launchFlags: '' };
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

/** An unfiltered, unfolded sidebar at its default width: what a first run gets, and what any field missing from the stored object falls back to. */
function defaultUi(): UiState {
  return {
    search: '',
    filters: { pinned: false, open: false, live: false, worktree: false, gone: false, siblings: false, noted: false, archived: false },
    datePreset: 'any',
    dateFrom: null,
    dateTo: null,
    filterPanelOpen: false,
    footerExpanded: true,
    collapsedProjects: [],
    collapsedGroups: [],
    filterCollapsedProjects: [],
    filterCollapsedGroups: [],
    sidebarWidth: null,
    scrollTop: 0,
    panelState: { sizes: {}, collapsed: [], active: {} },
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
  // Even with no `ui` at all: an older file's attention-strip setting is the one value in here worth carrying across.
  if (typeof legacyFooterExpanded === 'boolean') base.footerExpanded = legacyFooterExpanded;
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
    footerExpanded: bool(ui.footerExpanded, base.footerExpanded),
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
 * Stored window bounds, or null if there is nothing trustworthy there.
 * All four numbers are required together, because a partial rectangle is not a position — half of one would place the window somewhere nobody asked for.
 * `Number.isFinite` rather than a `typeof` check: JSON can hold `null`, and a NaN or Infinity that reached the file would come back out as an unopenable window rather than as an error.
 */
function parseBounds(raw: unknown): WindowBounds | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  const numbers = ['x', 'y', 'width', 'height'].map((key) => b[key]);
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [x, y, width, height] = numbers as number[];
  // A zero or negative size is damage, not a preference. Placement handles a size that is merely too SMALL by clamping it; this rejects the ones that are not sizes at all.
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height, maximized: b.maximized === true };
}

// Coerce a parsed blob into a well-formed Meta, tolerating older shapes (throws on non-object input).
function normalize(parsed: Record<string, unknown>): Meta {
  // `activeProject` was written as `activeFolder` before the project/folder terminology split; read the old key so an existing meta.json keeps its scope. The next write stores the new name.
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
    ? (parsed.groups as SessionGroup[]).filter(
        (g) => g && typeof g.id === 'string' && typeof g.name === 'string' && (typeof g.repoRoot === 'string' || g.repoRoot === null),
      )
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
    openSessions: Array.isArray(parsed.openSessions) ? (parsed.openSessions as string[]) : [],
    // Same reasoning as projectOrder below: a new defaulted field is not a reinterpretation of what is stored, so no version bump. Absent means "no memory yet" — open on nothing.
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
    // Same reasoning as projectOrder: a new defaulted field is not a reinterpretation of what is stored, so no version bump. Absent means nothing was ever chosen.
    settings: normalizeSettings(parsed.settings),
    // Same reasoning as projectOrder: no version bump for a new defaulted field. Non-string values are dropped so a hand-edited file can't put an object where a note should be.
    notes: Object.fromEntries(
      Object.entries((parsed.notes ?? {}) as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    groups,
    groupOf,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : '',
    // Anything a newer build wrote that this one has never heard of. Carried through untouched; nothing here is ever read.
    extra: Object.fromEntries(Object.entries(parsed).filter(([key]) => !KNOWN_KEYS.has(key))),
  };
}

// The last known-good copy, kept by writeMeta before each overwrite so a corrupt main file can be recovered instead of silently reset. Returns null when there's no usable backup.
async function readBackup(): Promise<Meta | null> {
  try {
    return normalize(JSON.parse(await fs.readFile(metaPath() + '.bak', 'utf8')) as Record<string, unknown>);
  } catch {
    return null;
  }
}

async function readMeta(): Promise<Meta> {
  let raw: string;
  try {
    raw = await fs.readFile(metaPath(), 'utf8');
  } catch {
    // No file yet (first run) or it was moved aside: prefer the last good backup, else defaults.
    return (await readBackup()) ?? defaults();
  }
  try {
    return normalize(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    // The file exists but won't parse (e.g. a write truncated by a crash). Preserve it for recovery rather than silently resetting, then fall back to the last good backup before defaults.
    try {
      await fs.writeFile(`${metaPath()}.corrupt-${Date.now()}.json`, raw);
    } catch {
      // Best-effort: if we can't preserve it, still recover below.
    }
    return (await readBackup()) ?? defaults();
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

/**
 * Keep a copy of meta.json as the OUTGOING version left it, the first time a different build writes.
 *
 * The existing `.bak` protects against a corrupt write; this protects against a version change, which is a different risk and needs its own copy — a rolling backup is overwritten by the very next write, so by the time anyone notices a new build mishandled something, the pre-upgrade state is long gone.
 * Stamped with the version that wrote it, so `meta.json.0.1.0.bak` is unambiguous.
 *
 * Best-effort throughout: failing to take a backup must never stop the app writing its metadata.
 */
async function snapshotOnVersionChange(storedVersion: string): Promise<void> {
  const current = app.getVersion();
  // No stored version means a file written before this was tracked, or a brand-new one. There is nothing a rollback could want back, so take no copy — just let the stamp below record this build.
  if (!storedVersion || storedVersion === current) return;
  const direction = compareVersions(current, storedVersion) < 0 ? 'DOWNGRADE' : 'upgrade';
  try {
    await fs.copyFile(metaPath(), `${metaPath()}.${storedVersion}.bak`);
  } catch {
    // No file to copy yet, or an unwritable directory: the stamp still happens.
  }
  try {
    await fs.appendFile(
      auditPath(),
      `${new Date().toISOString()} ===== ${direction} ${storedVersion} -> ${current} =====\n`,
    );
  } catch {
    // ignore
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  const file = metaPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Before anything overwrites the previous build's file.
  // This needs no "have I already done it" flag: the stamp below makes the stored version match the running one, so every later write hits the early return inside.
  await snapshotOnVersionChange(meta.appVersion);
  meta.appVersion = app.getVersion();
  // Keep the current file as the backup only if it's valid, so a corrupt main file can't clobber a good backup. This is the recovery point readMeta falls back to.
  try {
    const current = await fs.readFile(file, 'utf8');
    JSON.parse(current); // back up only parseable content
    await fs.writeFile(`${file}.bak`, current);
  } catch {
    // No existing file (first write) or it's already corrupt: leave any prior .bak untouched.
  }
  // Atomic replace: write a temp file then rename over the target, so a crash mid-write leaves the live meta.json intact (rename is atomic on the same filesystem).
  const tmp = `${file}.tmp`;
  // `extra` is a container for keys this build does not know, not a key of its own: spread its contents back alongside the known ones.
  // Known keys are written second so they always win, though by construction the two sets cannot overlap.
  const { extra, ...known } = meta;
  await fs.writeFile(tmp, JSON.stringify({ ...extra, ...known }, null, 2));
  await fs.rename(tmp, file);
}

// Serialize every meta operation.
// Each op is a read-modify-write; run concurrently they interleave (readMeta then writeMeta, all async) and a stale write can land last and win — which silently drops tab-list changes when several fire close together (restore opening tabs + user open/close).
// The queue makes each op run to completion before the next starts, so the last logical change wins.
let opQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(op: () => Promise<T>): Promise<T> {
  // Chain after the previous op whether it resolved or rejected, so one failure can't stall the queue.
  const run = opQueue.then(op, op);
  opQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
    await fs.appendFile(auditPath(), `${new Date().toISOString()} #${(auditSeq += 1)} ${text}\n`);
    await trimAudit();
  } catch {
    // ignore
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
  // The cut lands mid-line, so drop that partial record and start on a whole one. No newline at all means the tail is one oversized line with no complete record in it: keep none of it.
  const firstBreak = tail.indexOf(0x0a);
  await fs.writeFile(auditPath(), firstBreak === -1 ? Buffer.alloc(0) : tail.subarray(firstBreak + 1));
}

// Read-modify-write the meta as one atomic step in the queue. `mutate` returns the value to resolve.
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
    const pinned = new Set(meta.pinned);
    if (pinned.has(id)) pinned.delete(id);
    else pinned.add(id);
    meta.pinned = [...pinned];
    return meta.pinned;
  });
}

export function getArchived(): Promise<Record<string, number>> {
  return serialize(async () => (await readMeta()).archived);
}

export function toggleArchive(id: string): Promise<Record<string, number>> {
  return update('toggleArchive', (meta) => {
    if (id in meta.archived) delete meta.archived[id];
    else meta.archived[id] = Date.now();
    return meta.archived;
  });
}

/** Drop a session from all metadata (used when it is deleted). */
export function purgeSession(id: string): Promise<void> {
  return update('purgeSession', (meta) => {
    meta.pinned = meta.pinned.filter((k) => k !== id);
    meta.openSessions = meta.openSessions.filter((k) => k !== id);
    if (meta.activeSession === id) meta.activeSession = null;
    meta.activeSessionByProject = Object.fromEntries(
      Object.entries(meta.activeSessionByProject).filter(([, key]) => key !== id),
    );
    delete meta.archived[id];
    delete meta.groupOf[id];
    delete meta.notes[id];
  });
}

/**
 * Record that `/clear` replaced session `from` with session `to`, which Claude Code started under a copy of `from`'s name.
 *
 * DATA COLLECTION, deliberately and only. Nothing reads it back, and the app's behaviour does not depend on it.
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
    const trimmed = note.trim();
    if (trimmed) meta.notes[id] = trimmed;
    else delete meta.notes[id];
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

/** Store the sidebar's view state. Normalized on the way in, so a renderer bug cannot write a shape the next launch can't read. */
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
    const trimmed = name.trim();
    if (trimmed) meta.projectNames[repoRoot] = trimmed;
    else delete meta.projectNames[repoRoot];
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
 * Give every root a slot and return the order.
 * Two cases, deliberately different: an EMPTY order is seeded from `roots` exactly as given (the caller passes them in the order they already appear, so the run that introduces this feature changes nothing on screen); an existing order gets unknown roots at the FRONT, so a project that shows up later is somewhere you'll see it.
 *
 * Absent roots are NOT pruned.
 * A project whose sessions are all archived drops out of the list while still existing, and forgetting its slot would make it leap to the top when a session comes back — the opposite of the stable order this exists to provide.
 */
export function seedProjectOrder(roots: string[]): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    if (meta.projectOrder.length === 0) {
      if (roots.length === 0) return meta.projectOrder;
      meta.projectOrder = [...roots];
      await writeMeta(meta);
      await auditWrite('seedProjectOrder', meta);
      return meta.projectOrder;
    }
    const known = new Set(meta.projectOrder);
    const fresh = roots.filter((r) => !known.has(r));
    if (fresh.length === 0) return meta.projectOrder; // nothing new: no write at all
    meta.projectOrder = [...fresh, ...meta.projectOrder];
    await writeMeta(meta);
    await auditWrite('seedProjectOrder', meta);
    return meta.projectOrder;
  });
}

// Reorder one project among the others. Unknown roots are ignored: the order is seeded from what's actually on disk, so a root nobody has seen has no slot to move.
export function moveProject(repoRoot: string, move: OrderMove): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const from = meta.projectOrder.indexOf(repoRoot);
    if (from < 0) return meta.projectOrder;
    const to = moveTarget(from, meta.projectOrder.length - 1, move);
    if (to === null) return meta.projectOrder;
    meta.projectOrder.splice(to, 0, ...meta.projectOrder.splice(from, 1));
    await writeMeta(meta);
    await auditWrite('moveProject', meta);
    return meta.projectOrder;
  });
}

export function getGroupState(): Promise<GroupState> {
  return serialize(async () => groupState(await readMeta()));
}

/**
 * Create a group in a project, optionally moving a session into it in the same step (the row menu's "New group…" creates and moves at once).
 * Prepends, so a new group lands at the top of its project.
 * A blank name creates nothing — the caller's dialog can be dismissed empty.
 */
export function createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState> {
  return update('createGroup', (meta) => {
    const trimmed = name.trim();
    if (!trimmed) return groupState(meta);
    const group: SessionGroup = { id: randomUUID(), name: trimmed, repoRoot };
    meta.groups.unshift(group);
    if (sessionId) meta.groupOf[sessionId] = group.id;
    return groupState(meta);
  });
}

// Blank names are ignored rather than applied, so a group can never become nameless.
export function renameGroup(id: string, name: string): Promise<GroupState> {
  return update('renameGroup', (meta) => {
    const group = meta.groups.find((g) => g.id === id);
    const trimmed = name.trim();
    if (group && trimmed) group.name = trimmed;
    return groupState(meta);
  });
}

// Delete a group: it leaves the registry and its members go back to sitting under their project. The sessions themselves are never touched — this is display metadata only.
export function deleteGroup(id: string): Promise<GroupState> {
  return update('deleteGroup', (meta) => {
    meta.groups = meta.groups.filter((g) => g.id !== id);
    for (const [sessionId, groupId] of Object.entries(meta.groupOf)) {
      if (groupId === id) delete meta.groupOf[sessionId];
    }
    return groupState(meta);
  });
}

// Where an ordering move lands, given the current index and the last one.
// Returns null when the move would fall off an end or change nothing, so callers can skip the write entirely rather than silently clamping onto a no-op.
// Shared by groups and projects so both obey identical rules.
function moveTarget(from: number, last: number, move: OrderMove): number | null {
  const to = move === 'top' ? 0 : move === 'bottom' ? last : move === 'up' ? from - 1 : from + 1;
  if (to < 0 || to > last || to === from) return null;
  return to;
}

// Reorder a group within ITS OWN project.
// The registry is one flat array shared by every project, so the project's entries are lifted out by the slots they occupy, reordered, and written back into those same slots — which leaves every other project's position in the array untouched.
export function moveGroup(id: string, move: OrderMove): Promise<GroupState> {
  return update('moveGroup', (meta) => {
    const group = meta.groups.find((g) => g.id === id);
    if (!group) return groupState(meta);
    const slots: number[] = [];
    meta.groups.forEach((g, i) => {
      if (g.repoRoot === group.repoRoot) slots.push(i);
    });
    const from = slots.findIndex((i) => meta.groups[i].id === id);
    const to = moveTarget(from, slots.length - 1, move);
    if (to === null) return groupState(meta);
    const segment = slots.map((i) => meta.groups[i]);
    segment.splice(to, 0, ...segment.splice(from, 1));
    slots.forEach((slot, n) => {
      meta.groups[slot] = segment[n];
    });
    return groupState(meta);
  });
}

// Move a session into a group, or out of every group when groupId is null.
// It is a MOVE: any previous membership is replaced.
// An unknown group id is ignored rather than stored, so the membership can never name a group that isn't there.
export function moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState> {
  return update('moveSessionToGroup', (meta) => {
    if (groupId === null) delete meta.groupOf[sessionId];
    else if (meta.groups.some((g) => g.id === groupId)) meta.groupOf[sessionId] = groupId;
    return groupState(meta);
  });
}
