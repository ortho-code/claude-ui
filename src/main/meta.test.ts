import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// meta.ts stores its JSON under app.getPath('userData'); point that at a fresh temp dir per test.
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEST_USERDATA } }));

import {
  getPinned,
  togglePin,
  getArchived,
  toggleArchive,
  purgeConversation,
  getOpenSessions,
  setOpenSessions,
  getActiveFolder,
  setActiveFolder,
  migrateToConversationKeys,
} from './meta';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-meta-'));
  process.env.TEST_USERDATA = dir;
});

async function writeMetaFile(contents: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(contents));
}

describe('pins', () => {
  it('toggles a pin on and off', async () => {
    expect(await getPinned()).toEqual([]);
    expect(await togglePin('conv1')).toEqual(['conv1']);
    expect(await getPinned()).toEqual(['conv1']);
    expect(await togglePin('conv1')).toEqual([]);
  });
});

describe('archive', () => {
  it('archives with a timestamp and unarchives', async () => {
    const archived = await toggleArchive('conv1');
    expect(Object.keys(archived)).toEqual(['conv1']);
    expect(archived.conv1).toBeGreaterThan(0);
    expect(await toggleArchive('conv1')).toEqual({});
  });

  it('reads a legacy archived id-array as a map with unknown (0) timestamps', async () => {
    await writeMetaFile({ pinned: [], openSessions: [], archived: ['a', 'b'], version: 2 });
    expect(await getArchived()).toEqual({ a: 0, b: 0 });
  });
});

describe('purgeConversation', () => {
  it('drops the conversation from pins, open tabs and archive', async () => {
    await togglePin('conv1');
    await toggleArchive('conv1');
    await setOpenSessions(['conv1', 'conv2']);
    await purgeConversation('conv1');
    expect(await getPinned()).toEqual([]);
    expect(await getArchived()).toEqual({});
    expect(await getOpenSessions()).toEqual(['conv2']);
  });
});

describe('migrateToConversationKeys', () => {
  it('remaps raw session ids to conversation keys once, then is idempotent', async () => {
    await writeMetaFile({ pinned: ['sess1'], openSessions: ['sess1', 'sess2'], version: 1 });
    await migrateToConversationKeys(new Map([['sess1', 'conv1'], ['sess2', 'conv2']]));
    expect(await getPinned()).toEqual(['conv1']);
    expect(await getOpenSessions()).toEqual(['conv1', 'conv2']);
    // Already at version 2: a second run must not remap again.
    await migrateToConversationKeys(new Map([['conv1', 'other']]));
    expect(await getPinned()).toEqual(['conv1']);
  });

  it('leaves entries that match no known session id untouched', async () => {
    await writeMetaFile({ pinned: ['already-a-conv-key'], openSessions: [], version: 1 });
    await migrateToConversationKeys(new Map([['sess1', 'conv1']]));
    expect(await getPinned()).toEqual(['already-a-conv-key']);
  });
});

describe('active folder', () => {
  it('defaults to null and round-trips a project and back to All', async () => {
    expect(await getActiveFolder()).toBeNull();
    await setActiveFolder('/home/me/dev/scienta');
    expect(await getActiveFolder()).toBe('/home/me/dev/scienta');
    await setActiveFolder(null);
    expect(await getActiveFolder()).toBeNull();
  });

  it('ignores a non-string persisted value', async () => {
    await writeMetaFile({ activeFolder: 42 });
    expect(await getActiveFolder()).toBeNull();
  });
});
