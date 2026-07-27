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
  /** Schema version; 2 = keyed by conversation, migrated from raw session ids. */
  version: number;
}

function metaPath(): string {
  return path.join(app.getPath('userData'), 'meta.json');
}

async function readMeta(): Promise<Meta> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath(), 'utf8')) as Partial<Meta>;
    return {
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      openSessions: Array.isArray(parsed.openSessions) ? parsed.openSessions : [],
      version: typeof parsed.version === 'number' ? parsed.version : 1,
    };
  } catch {
    return { pinned: [], openSessions: [], version: 2 };
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

export async function getOpenSessions(): Promise<string[]> {
  return (await readMeta()).openSessions;
}

export async function setOpenSessions(ids: string[]): Promise<void> {
  const meta = await readMeta();
  meta.openSessions = ids;
  await writeMeta(meta);
}
