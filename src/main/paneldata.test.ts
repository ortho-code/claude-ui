import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { promises as fs, rmSync } from 'node:fs';
import * as path from 'node:path';

// A real folder, so the atomic write and the keeping-aside are exercised on a real filesystem.
const { dataDir, logged } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-paneldata-')), logged: [] as string[] };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('./log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { forgetSessions, linkSession, readPanelData, registerPanelData } from './paneldata';
import { panelDataDir } from './paths';

const file = (entryId: string): string => path.join(panelDataDir, `${entryId}.json`);
const LINK = { key: 'org/repo#1', label: 'Fix the login redirect', href: 'https://github.com/org/repo/pull/1' };

/** The sessions that exist, as main would answer: by default every one asked about. */
let alive: ((ids: string[]) => Promise<Set<string>>) | null = null;

beforeEach(async () => {
  await fs.rm(panelDataDir, { recursive: true, force: true });
  logged.length = 0;
  alive = null;
  registerPanelData(
    () => null,
    (ids) => (alive ? alive(ids) : Promise.resolve(new Set(ids))),
  );
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('a panel’s own data', () => {
  it('is empty for a panel that has nothing yet, and for a key that is not an entry’s id', async () => {
    expect(await readPanelData('reviews')).toEqual({ sessions: {}, lastGroup: {} });
    expect(await readPanelData('#0.2')).toEqual({ sessions: {}, lastGroup: {} });
    expect(logged).toEqual([]);
  });

  it('remembers a session started from a row, and the group it was filed in, in a file of the panel’s own', async () => {
    const data = await linkSession('reviews', 's1', LINK, { repoRoot: '/repo', groupId: 'g1' });
    expect(data.sessions.s1).toMatchObject(LINK);
    expect(Date.parse(data.sessions.s1.startedAt)).not.toBeNaN();
    expect(data.lastGroup).toEqual({ '/repo': 'g1' });
    const written = JSON.parse(await fs.readFile(file('reviews'), 'utf8'));
    expect(written.version).toBe(1);
    expect(await readPanelData('reviews')).toEqual(data);
    expect(await fs.readdir(panelDataDir)).toEqual(['reviews.json']);
  });

  it('keeps every link when several are written at once', async () => {
    await Promise.all(['s1', 's2', 's3'].map((id) => linkSession('reviews', id, LINK, { repoRoot: '/repo', groupId: null })));
    expect(Object.keys((await readPanelData('reviews')).sessions).sort()).toEqual(['s1', 's2', 's3']);
  });

  it('writes nothing for a key that is not an entry’s id', async () => {
    await linkSession('@cli', 's1', LINK, { repoRoot: '/repo', groupId: null });
    await expect(fs.readdir(panelDataDir)).rejects.toThrow();
  });

  it('keeps a file it cannot read beside itself rather than overwriting it, and says so', async () => {
    await fs.mkdir(panelDataDir, { recursive: true });
    await fs.writeFile(file('reviews'), '{"version": 1, "sessions": {');
    expect(await readPanelData('reviews')).toEqual({ sessions: {}, lastGroup: {} });
    const names = await fs.readdir(panelDataDir);
    expect(names).toEqual([expect.stringMatching(/^reviews\.json\.corrupt-\d+\.json$/)]);
    expect(await fs.readFile(path.join(panelDataDir, names[0]), 'utf8')).toBe('{"version": 1, "sessions": {');
    expect(logged).toEqual([expect.stringMatching(/^warn panel-data .+reviews\.json does not parse, kept as reviews\.json\.corrupt-\d+\.json; starting it empty$/)]);
  });

  it('keeps a file of another version aside too, so a later build’s data is never overwritten', async () => {
    await fs.mkdir(panelDataDir, { recursive: true });
    await fs.writeFile(file('reviews'), '{"version": 2, "sessions": {}}');
    await readPanelData('reviews');
    expect(await fs.readdir(panelDataDir)).toEqual([expect.stringMatching(/^reviews\.json\.unread-\d+\.json$/)]);
  });

  it('drops an entry that is not sound, keeps the rest, and says how many it dropped', async () => {
    await fs.mkdir(panelDataDir, { recursive: true });
    const good = { ...LINK, startedAt: '2026-09-30T10:00:00.000Z' };
    await fs.writeFile(file('reviews'), JSON.stringify({ version: 1, sessions: { s1: good, s2: { key: 3 } }, lastGroup: { '/repo': 'g1', '/other': 7 } }));
    expect(await readPanelData('reviews')).toEqual({ sessions: { s1: good }, lastGroup: { '/repo': 'g1' } });
    expect(logged).toEqual([expect.stringMatching(/^warn panel-data .+reviews\.json: dropped 2 entries that were not sound$/)]);
  });

  it('forgets, at the next write, a session that no longer exists, and keeps the one being linked though it has no transcript or tab yet', async () => {
    await linkSession('reviews', 'gone', LINK, { repoRoot: '/repo', groupId: null });
    await linkSession('reviews', 'still-here', LINK, { repoRoot: '/repo', groupId: null });
    alive = (ids) => Promise.resolve(new Set(ids.filter((id) => id === 'still-here')));
    // Reading forgets nothing: only a write does.
    expect(Object.keys((await readPanelData('reviews')).sessions).sort()).toEqual(['gone', 'still-here']);
    const data = await linkSession('reviews', 'brand-new', LINK, { repoRoot: '/repo', groupId: null });
    expect(Object.keys(data.sessions).sort()).toEqual(['brand-new', 'still-here']);
    expect(logged).toEqual([expect.stringMatching(/^info panel-data .+reviews\.json: forgot 1 session that no longer exists$/)]);
  });

  it('forgets nothing when it cannot tell which sessions exist', async () => {
    await linkSession('reviews', 's1', LINK, { repoRoot: '/repo', groupId: null });
    alive = () => Promise.reject(new Error('meta unreadable'));
    const data = await linkSession('reviews', 's2', LINK, { repoRoot: '/repo', groupId: null });
    expect(Object.keys(data.sessions).sort()).toEqual(['s1', 's2']);
    expect(logged).toEqual([expect.stringMatching(/could not tell which sessions still exist \(meta unreadable\), so none were forgotten$/)]);
  });

  it('forgets a deleted session in every panel that names it, and leaves the others alone', async () => {
    await linkSession('reviews', 's1', LINK, { repoRoot: '/repo', groupId: null });
    await linkSession('reviews', 's2', LINK, { repoRoot: '/repo', groupId: null });
    await linkSession('ci', 's1', LINK, { repoRoot: '/repo', groupId: null });
    await linkSession('other', 's9', LINK, { repoRoot: '/repo', groupId: null });
    const before = await fs.stat(file('other'));
    await forgetSessions(['s1']);
    expect(Object.keys((await readPanelData('reviews')).sessions)).toEqual(['s2']);
    expect((await readPanelData('ci')).sessions).toEqual({});
    // Not rewritten: nothing in it changed.
    expect((await fs.stat(file('other'))).mtimeMs).toBe(before.mtimeMs);
  });
});
