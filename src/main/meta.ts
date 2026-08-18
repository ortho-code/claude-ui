import { app } from 'electron';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { GroupState, SessionGroup } from '../shared/types';

/**
 * UI-only metadata, kept outside ~/.claude so we never touch the session store.
 * `pinned` and `openSessions` hold session ids (the .jsonl file ids). Session ids are immutable,
 * unlike the conversation keys of v2, which stopped matching their session the moment it gained a
 * sibling (the row then keys by its own id) — silently losing tabs and pins.
 */
interface Meta {
  pinned: string[];
  openSessions: string[];
  /** Archived session ids mapped to when they were archived (epoch ms; 0 = unknown). */
  archived: Record<string, number>;
  /** The project the sidebar switcher is scoped to (repoRoot), or null for "All". */
  activeProject: string | null;
  /** Per-project display-name overrides, keyed by repoRoot; absent = use the folder name. */
  projectNames: Record<string, string>;
  /** User-defined session groups, in display order (a new one is prepended). */
  groups: SessionGroup[];
  /** Session id -> group id; a session is in at most one group. */
  groupOf: Record<string, string>;
  /** Schema version; 3 = keyed by session id; 2 was conversation-keyed; 1 raw ids. */
  version: number;
}

function metaPath(): string {
  return path.join(app.getPath('userData'), 'meta.json');
}

function defaults(): Meta {
  return { pinned: [], openSessions: [], archived: {}, activeProject: null, projectNames: {}, groups: [], groupOf: {}, version: 3 };
}

// Coerce a parsed blob into a well-formed Meta, tolerating older shapes (throws on non-object input).
function normalize(parsed: Record<string, unknown>): Meta {
  // `activeProject` was written as `activeFolder` before the project/folder terminology split; read
  // the old key so an existing meta.json keeps its scope. The next write stores the new name.
  const rawActive = parsed.activeProject ?? parsed.activeFolder;
  // `archived` was once a plain id list; migrate that to the id->timestamp map (0 = unknown).
  const rawArchived = parsed.archived;
  let archived: Record<string, number> = {};
  if (Array.isArray(rawArchived)) {
    for (const id of rawArchived) if (typeof id === 'string') archived[id] = 0;
  } else if (rawArchived && typeof rawArchived === 'object') {
    archived = rawArchived as Record<string, number>;
  }
  // Drop malformed group entries, then any membership naming a group that no longer exists, so a
  // hand-edited or half-written file can't leave a session pointing at nothing.
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
    archived,
    activeProject: typeof rawActive === 'string' ? rawActive : null,
    projectNames:
      parsed.projectNames && typeof parsed.projectNames === 'object'
        ? (parsed.projectNames as Record<string, string>)
        : {},
    groups,
    groupOf,
    version: typeof parsed.version === 'number' ? parsed.version : 1,
  };
}

// The last known-good copy, kept by writeMeta before each overwrite so a corrupt main file can be
// recovered instead of silently reset. Returns null when there's no usable backup.
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
    // The file exists but won't parse (e.g. a write truncated by a crash). Preserve it for recovery
    // rather than silently resetting, then fall back to the last good backup before defaults.
    try {
      await fs.writeFile(`${metaPath()}.corrupt-${Date.now()}.json`, raw);
    } catch {
      // Best-effort: if we can't preserve it, still recover below.
    }
    return (await readBackup()) ?? defaults();
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  const file = metaPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Keep the current file as the backup only if it's valid, so a corrupt main file can't clobber a
  // good backup. This is the recovery point readMeta falls back to.
  try {
    const current = await fs.readFile(file, 'utf8');
    JSON.parse(current); // back up only parseable content
    await fs.writeFile(`${file}.bak`, current);
  } catch {
    // No existing file (first write) or it's already corrupt: leave any prior .bak untouched.
  }
  // Atomic replace: write a temp file then rename over the target, so a crash mid-write leaves the
  // live meta.json intact (rename is atomic on the same filesystem).
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(meta, null, 2));
  await fs.rename(tmp, file);
}

// Serialize every meta operation. Each op is a read-modify-write; run concurrently they interleave
// (readMeta then writeMeta, all async) and a stale write can land last and win — which silently drops
// tab-list changes when several fire close together (restore opening tabs + user open/close). The
// queue makes each op run to completion before the next starts, so the last logical change wins.
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

// TEMPORARY debug aid (remove once tab persistence is trusted — see .plan): append one line per
// write to meta-audit.log, so a dropped tab-list change can be traced to the op and moment that
// wrote it. Best-effort — logging must never break a real write.
let auditSeq = 0;
function auditPath(): string {
  return path.join(app.getPath('userData'), 'meta-audit.log');
}
async function auditWrite(op: string, meta: Meta): Promise<void> {
  try {
    const line = `${new Date().toISOString()} #${(auditSeq += 1)} ${op} open=${JSON.stringify(meta.openSessions)} pinned=${JSON.stringify(meta.pinned)}\n`;
    await fs.appendFile(auditPath(), line);
  } catch {
    // ignore
  }
}

// Append a lifecycle marker (STARTUP/QUITTING) with the on-disk open-tabs at that moment, so restart
// boundaries are visible in the log. On STARTUP, trim the log to the last few restarts so it can't
// grow unbounded. Serialized with the writes so a marker and the trim can't race an append.
export function auditMarker(label: string): Promise<void> {
  return serialize(async () => {
    try {
      const meta = await readMeta();
      const line = `${new Date().toISOString()} ===== ${label} ===== open=${JSON.stringify(meta.openSessions)}\n`;
      await fs.appendFile(auditPath(), line);
      if (label === 'STARTUP') await trimAudit();
    } catch {
      // ignore
    }
  });
}

// Keep only the last `keepRestarts` STARTUP segments; drop everything before that.
async function trimAudit(keepRestarts = 5): Promise<void> {
  const text = await fs.readFile(auditPath(), 'utf8').catch(() => '');
  if (!text) return;
  const lines = text.split('\n');
  const starts = lines.flatMap((line, i) => (line.includes('===== STARTUP =====') ? [i] : []));
  if (starts.length <= keepRestarts) return;
  await fs.writeFile(auditPath(), lines.slice(starts[starts.length - keepRestarts]).join('\n'));
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
 * One-time upgrade of pins/open-tabs/archived to SESSION ids, from conversation keys (v2) or raw
 * ids (v1). Any key that matches a session's conversationId is rewritten to that session's id (for
 * a multi-file family: its latest member — the row the old model showed); id keys and keys naming
 * a session no longer on disk pass through unchanged, which also makes a v1 file migrate correctly.
 */
export function migrateToSessionKeys(conversationToId: Map<string, string>): Promise<void> {
  return serialize(async () => {
    const meta = await readMeta();
    if (meta.version >= 3) return;
    const remapKey = (k: string): string => conversationToId.get(k) ?? k;
    meta.pinned = [...new Set(meta.pinned.map(remapKey))];
    meta.openSessions = [...new Set(meta.openSessions.map(remapKey))];
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
    delete meta.archived[id];
    delete meta.groupOf[id];
  });
}

export function getOpenSessions(): Promise<string[]> {
  return serialize(async () => (await readMeta()).openSessions);
}

export function setOpenSessions(ids: string[]): Promise<void> {
  return update('setOpenSessions', (meta) => {
    meta.openSessions = ids;
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

// --- Session groups -------------------------------------------------------------------------
// A group is a user-made sub-section inside one project. Membership is one group per session, so
// `groupOf` alone is the whole truth: a session cannot be in two groups by construction. Every
// mutation returns the WHOLE state, since the registry and the membership only make sense together.

function groupState(meta: Meta): GroupState {
  return { groups: meta.groups, groupOf: meta.groupOf };
}

export function getGroupState(): Promise<GroupState> {
  return serialize(async () => groupState(await readMeta()));
}

/**
 * Create a group in a project, optionally moving a session into it in the same step (the row menu's
 * "New group…" creates and moves at once). Prepends, so a new group lands at the top of its project.
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

// Delete a group: it leaves the registry and its members go back to sitting under their project.
// The sessions themselves are never touched — this is display metadata only.
export function deleteGroup(id: string): Promise<GroupState> {
  return update('deleteGroup', (meta) => {
    meta.groups = meta.groups.filter((g) => g.id !== id);
    for (const [sessionId, groupId] of Object.entries(meta.groupOf)) {
      if (groupId === id) delete meta.groupOf[sessionId];
    }
    return groupState(meta);
  });
}

// Move a session into a group, or out of every group when groupId is null. It is a MOVE: any
// previous membership is replaced. An unknown group id is ignored rather than stored, so the
// membership can never name a group that isn't there.
export function moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState> {
  return update('moveSessionToGroup', (meta) => {
    if (groupId === null) delete meta.groupOf[sessionId];
    else if (meta.groups.some((g) => g.id === groupId)) meta.groupOf[sessionId] = groupId;
    return groupState(meta);
  });
}
