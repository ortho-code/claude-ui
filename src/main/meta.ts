import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** UI-only metadata, kept outside ~/.claude so we never touch the session store. */
interface Meta {
  pinned: string[];
  openSessions: string[];
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
    };
  } catch {
    return { pinned: [], openSessions: [] };
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await fs.mkdir(path.dirname(metaPath()), { recursive: true });
  await fs.writeFile(metaPath(), JSON.stringify(meta, null, 2));
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
