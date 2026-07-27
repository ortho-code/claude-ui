import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * UI-only metadata, kept outside ~/.claude so we never touch the session store.
 * `pinned` and `openSessions` hold conversation keys (first-message uuids), not raw session
 * ids, so an entry survives a conversation branching (compaction or an explicit fork).
 */
interface Meta {
  pinned: string[];
  openSessions: string[];
  /** Archived conversation keys mapped to when they were archived (epoch ms; 0 = unknown). */
  archived: Record<string, number>;
  /** Schema version; 2 = keyed by conversation, migrated from raw session ids. */
  version: number;
}

function metaPath(): string {
  return path.join(app.getPath('userData'), 'meta.json');
}

async function readMeta(): Promise<Meta> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath(), 'utf8')) as Record<string, unknown>;
    // `archived` was once a plain id list; migrate that to the id->timestamp map (0 = unknown).
    const rawArchived = parsed.archived;
    let archived: Record<string, number> = {};
    if (Array.isArray(rawArchived)) {
      for (const id of rawArchived) if (typeof id === 'string') archived[id] = 0;
    } else if (rawArchived && typeof rawArchived === 'object') {
      archived = rawArchived as Record<string, number>;
    }
    return {
      pinned: Array.isArray(parsed.pinned) ? (parsed.pinned as string[]) : [],
      openSessions: Array.isArray(parsed.openSessions) ? (parsed.openSessions as string[]) : [],
      archived,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    };
  } catch {
    return { pinned: [], openSessions: [], archived: {}, version: 2 };
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await fs.mkdir(path.dirname(metaPath()), { recursive: true });
  await fs.writeFile(metaPath(), JSON.stringify(meta, null, 2));
}

/**
 * One-time upgrade of pins/open-tabs from raw session ids to conversation keys. Any entry that
 * matches a known session id is rewritten to that session's conversation key; entries that are
 * already conversation keys (or name a session no longer on disk) are left as-is.
 */
export async function migrateToConversationKeys(idToConversation: Map<string, string>): Promise<void> {
  const meta = await readMeta();
  if (meta.version >= 2) return;
  const remap = (keys: string[]): string[] => [...new Set(keys.map((k) => idToConversation.get(k) ?? k))];
  meta.pinned = remap(meta.pinned);
  meta.openSessions = remap(meta.openSessions);
  meta.version = 2;
  await writeMeta(meta);
}

export async function getPinned(): Promise<string[]> {
  return (await readMeta()).pinned;
}

export async function togglePin(id: string): Promise<string[]> {
  const meta = await readMeta();
  const pinned = new Set(meta.pinned);
  if (pinned.has(id)) pinned.delete(id);
  else pinned.add(id);
  meta.pinned = [...pinned];
  await writeMeta(meta);
  return meta.pinned;
}

export async function getArchived(): Promise<Record<string, number>> {
  return (await readMeta()).archived;
}

export async function toggleArchive(id: string): Promise<Record<string, number>> {
  const meta = await readMeta();
  if (id in meta.archived) delete meta.archived[id];
  else meta.archived[id] = Date.now();
  await writeMeta(meta);
  return meta.archived;
}

/** Drop a conversation from all metadata (used when it is deleted). */
export async function purgeConversation(id: string): Promise<void> {
  const meta = await readMeta();
  meta.pinned = meta.pinned.filter((k) => k !== id);
  meta.openSessions = meta.openSessions.filter((k) => k !== id);
  delete meta.archived[id];
  await writeMeta(meta);
}

export async function getOpenSessions(): Promise<string[]> {
  return (await readMeta()).openSessions;
}

export async function setOpenSessions(ids: string[]): Promise<void> {
  const meta = await readMeta();
  meta.openSessions = ids;
  await writeMeta(meta);
}
