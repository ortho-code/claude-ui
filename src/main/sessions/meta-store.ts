import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { SetAside, NeedsYou, SettledNeedsYou, HistoryPin, PrSeen, ScheduledTask, SessionGroup, SessionPr, UiState, Settings } from '../../shared/types';
import { defaultSettings, defaultUi } from '../../shared/config/defaults';
import { parseBounds, type WindowBounds } from '../window/bounds';
import { normalizeUi } from '../window/ui-state';
import { needsYouHistoryOf, needsYouOf, scheduledBySession, setAsideOf, setAsideWithPaused, storedNeedsYou } from '../status/stored-marks';
import { prLinksOf, prSeenOf } from './stored-prs';
import { appendStamped } from '../files/stamp';
import { goodCopy, writeWithBackups } from '../files/backup';
import { errorText, fsFailure, log, logOnce } from '../logs/log';
import { inTurn } from '../files/queue';
import { recordUsage, type DecideAct, type DecidedBy, type UsageEvent } from '../logs/usage';

/** The preferences as kept here before the config folder: the launch flags, the one setting there was. */
export type MetaSettings = Pick<Settings, 'launchFlags'>;

/**
 * UI-only metadata, kept outside ~/.claude so we never touch the session store.
 * `pinned` and `openSessions` hold session ids (the .jsonl file ids).
 * Session ids are immutable, unlike the conversation keys of v2, which stopped matching their session the moment it gained a sibling (the row then keys by its own id) — silently losing tabs and pins.
 */
export interface Meta {
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

export async function readMeta(): Promise<Meta> {
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
export function serialize<T>(op: () => Promise<T>): Promise<T> {
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

/** Write `meta` and its audit line, `op` naming what wrote it; the caller is inside `serialize`. */
export async function writeAudited(op: string, meta: Meta): Promise<void> {
  await writeMeta(meta);
  await auditWrite(op, meta);
}

// Read-modify-write the meta as one atomic step in the queue.
// `mutate` returns the value to resolve, and pushes onto `usage` what the write did that the usage record counts, which is appended once the write has landed.
export function update<T>(op: string, mutate: (meta: Meta, usage: UsageEvent[]) => T): Promise<T> {
  return serialize(async () => {
    const meta = await readMeta();
    const usage: UsageEvent[] = [];
    const result = mutate(meta, usage);
    await writeAudited(op, meta);
    await recordUsage(usage);
    return result;
  });
}

/** A decision for the usage record, of the sessions it changed, with what wrote it when that was not you; none changed is no line. */
export function decided(act: DecideAct, ids: readonly string[], by?: DecidedBy): UsageEvent[] {
  const changed = [...new Set(ids)];
  if (changed.length === 0) return [];
  return [by === undefined ? { kind: 'decide', act, ids: changed } : { kind: 'decide', act, ids: changed, by }];
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
    await writeAudited('migrate', meta);
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
