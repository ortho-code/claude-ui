import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { promises as fs, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

// A real folder, so both files and meta.json are read from disk as main reads them.
const { dataDir, logged } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-settings-')), logged: [] as string[] };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {}, getVersion: () => '0.4.0' },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

const configRoot = path.join(dataDir, 'config');
const yoursFile = path.join(configRoot, 'settings.json');
const appFile = path.join(configRoot, 'settings.local.json');
const metaFile = path.join(dataDir, 'meta.json');
const json = async (file: string): Promise<unknown> => JSON.parse(await fs.readFile(file, 'utf8'));

/** The module afresh, as a launch has it: nothing read yet, nothing moved this run. */
const fresh = async (): Promise<typeof import('../../../src/main/settings')> => {
  vi.resetModules();
  return import('../../../src/main/settings');
};

beforeEach(async () => {
  logged.length = 0;
  await fs.rm(dataDir, { recursive: true, force: true });
  mkdirSync(configRoot, { recursive: true });
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('reading the settings', () => {
  it('takes the app’s file over yours, for a session’s start too', async () => {
    writeFileSync(yoursFile, '{\n  // mine\n  "launchFlags": "--mine",\n}\n');
    writeFileSync(appFile, '{ "launchFlags": "--app" }\n');
    const settings = await fresh();
    expect((await settings.readSettings()).launchFlags).toMatchObject({ value: '--app', source: 'app', without: '--mine' });
    expect(await settings.settingsNow()).toEqual({ launchFlags: '--app' });
  });

  it('keeps what a file last read in force while it does not parse, and drops it once the file is gone', async () => {
    const settings = await fresh();
    writeFileSync(yoursFile, '{ "launchFlags": "--mine" }\n');
    expect((await settings.readSettings()).launchFlags.value).toBe('--mine');
    writeFileSync(yoursFile, '{ "launchFlags": "--mi');
    const broken = await settings.readSettings();
    expect(broken.launchFlags.value).toBe('--mine');
    expect(broken.files.yours).toMatchObject({ status: 'unparsable' });
    await fs.rm(yoursFile);
    expect((await settings.readSettings()).launchFlags).toMatchObject({ value: '', source: 'default' });
  });

  it('logs what is wrong once per change, and never a flag’s value', async () => {
    writeFileSync(yoursFile, '{ "launchFlags": "update --secret-value", "lanchFlags": 1 }\n');
    const settings = await fresh();
    await settings.readSettings();
    await settings.readSettings();
    const lines = logged.filter((line) => line.includes(' settings '));
    expect(lines).toEqual(['warn settings settings.json: "lanchFlags" is not a setting the app has.; launchFlags in settings.json is not used, Settings says why']);
    expect(lines.join()).not.toContain('secret');
    writeFileSync(yoursFile, '{}\n');
    await settings.readSettings();
    expect(logged.at(-1)).toBe('info settings both settings files read without a mistake');
  });
});

describe('saving from Settings', () => {
  it('writes the app’s file and leaves yours alone', async () => {
    writeFileSync(yoursFile, '{ "launchFlags": "--mine" }\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--allowedTools Grep' });
    expect(saved.refused).toBeNull();
    expect(saved.view.launchFlags).toMatchObject({ value: '--allowedTools Grep', source: 'app' });
    expect(await json(appFile)).toEqual({ launchFlags: '--allowedTools Grep' });
    expect(await fs.readFile(yoursFile, 'utf8')).toBe('{ "launchFlags": "--mine" }\n');
  });

  it('removes the app’s value when the save equals yours, rather than keeping a copy', async () => {
    writeFileSync(yoursFile, '{ "launchFlags": "--mine" }\n');
    writeFileSync(appFile, '{ "launchFlags": "--app" }\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--mine' });
    expect(saved.view.launchFlags).toMatchObject({ value: '--mine', source: 'yours' });
    expect(await json(appFile)).toEqual({});
  });

  it('refuses a value the setting may not hold, writing nothing', async () => {
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--resume other' });
    expect(saved.refused).toBe("--resume can't be set here — claude-ui decides which session a tab resumes.");
    await expect(fs.access(appFile)).rejects.toThrow();
  });

  it('refuses to write over an app’s file a person left not parsing, saying where it goes wrong', async () => {
    writeFileSync(appFile, '{ "launchFlags": "--a"\n "x": 1 }\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--b' });
    expect(saved.refused).toBe('settings.local.json does not parse, so it was not written: expected a comma at line 2, column 2');
    expect(await fs.readFile(appFile, 'utf8')).toBe('{ "launchFlags": "--a"\n "x": 1 }\n');
  });
});

describe('the move from meta.json', () => {
  const metaWith = (fields: Record<string, unknown>): void => writeFileSync(metaFile, JSON.stringify({ version: 3, appVersion: '0.4.0', ...fields }));

  it('moves the flags an older build kept into the app’s file, once, and leaves meta’s copy where it was', async () => {
    metaWith({ settings: { launchFlags: '--allowedTools Grep,Glob' } });
    let settings = await fresh();
    settings.registerSettings(() => null);
    expect((await settings.readSettings()).launchFlags).toMatchObject({ value: '--allowedTools Grep,Glob', source: 'app' });
    const meta = (await json(metaFile)) as { settings: unknown; moved: unknown };
    expect(meta.settings).toEqual({ launchFlags: '--allowedTools Grep,Glob' });
    expect(meta.moved).toEqual(['launchFlags']);
    // Deleting the app's file is how what the app changed is reset: the next launch must not bring the old flags back.
    await fs.rm(appFile);
    settings = await fresh();
    settings.registerSettings(() => null);
    expect((await settings.readSettings()).launchFlags).toMatchObject({ value: '', source: 'default' });
  });

  it('leaves alone flags the app’s file already holds', async () => {
    metaWith({ settings: { launchFlags: '--old' } });
    writeFileSync(appFile, '{ "launchFlags": "--newer" }\n');
    const settings = await fresh();
    settings.registerSettings(() => null);
    expect((await settings.readSettings()).launchFlags.value).toBe('--newer');
  });

  it('writes no file for the default, and still records the move', async () => {
    metaWith({});
    const settings = await fresh();
    settings.registerSettings(() => null);
    await settings.readSettings();
    await expect(fs.access(appFile)).rejects.toThrow();
    expect(((await json(metaFile)) as { moved: unknown }).moved).toEqual(['launchFlags']);
  });
});

describe('telling the window', () => {
  it('pushes the settings when a person edits either file, and not after Settings’ own save', async () => {
    vi.resetModules();
    const config = await import('../../../src/main/config');
    const settings = await import('../../../src/main/settings');
    const sent: [string, unknown][] = [];
    const window = { isDestroyed: () => false, webContents: { send: (channel: string, payload: unknown) => sent.push([channel, payload]) } };
    const stop = config.registerConfig(() => window as never);
    settings.registerSettings(() => window as never);
    try {
      await settings.readSettings();
      await settings.saveSettings({ launchFlags: '--a' });
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(sent.filter(([channel]) => channel === 'settings:changed')).toEqual([]);
      writeFileSync(yoursFile, '{ "launchFlags": "--mine" }\n');
      await vi.waitFor(() => expect(sent.filter(([channel]) => channel === 'settings:changed')).toHaveLength(1), { timeout: 3000 });
    } finally {
      stop();
    }
  });
});
