import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { promises as fs, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { readJsonc } from '../../../src/main/jsonc';

// A real folder, so settings.json, the old settings.local.json and meta.json are read from disk as main reads them.
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
const settingsFile = path.join(configRoot, 'settings.json');
const localFile = path.join(configRoot, 'settings.local.json');
const metaFile = path.join(dataDir, 'meta.json');
const json = async (file: string): Promise<unknown> => JSON.parse(await fs.readFile(file, 'utf8'));
/** A config file's value, read as the config folder's format, comments and all. */
const jsonc = async (file: string): Promise<unknown> => {
  const read = readJsonc(await fs.readFile(file, 'utf8'));
  return read.ok ? read.json : read.error;
};
const defaults = { launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: true };
const text = (file: string): Promise<string> => fs.readFile(file, 'utf8');
const gone = (file: string): Promise<void> => expect(fs.access(file)).rejects.toThrow();
const moves = async (): Promise<unknown> => ((await json(metaFile)) as { moved: unknown }).moved;

/** The module afresh, as a launch has it: nothing read yet, nothing moved this run. */
const fresh = async (): Promise<typeof import('../../../src/main/settings')> => {
  vi.resetModules();
  return import('../../../src/main/settings');
};

/** A launch: the module afresh, registered, so its moves run before its first read. */
const launch = async (): Promise<typeof import('../../../src/main/settings')> => {
  const settings = await fresh();
  settings.registerSettings(() => null);
  return settings;
};

beforeEach(async () => {
  logged.length = 0;
  await fs.rm(dataDir, { recursive: true, force: true });
  mkdirSync(configRoot, { recursive: true });
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('reading the settings', () => {
  it('takes settings.json over the default, for a session’s start too', async () => {
    writeFileSync(settingsFile, '{\n  // mine\n  "launchFlags": "--mine",\n}\n');
    const settings = await fresh();
    expect((await settings.readSettings()).launchFlags).toEqual({ value: '--mine', problem: null });
    expect(await settings.settingsNow()).toEqual({ launchFlags: '--mine', runningSessionsAtLaunch: 'pause', prStatus: true });
  });

  it('numbers each read in the order reads start, so one started before a save is numbered below the save’s answer', async () => {
    const settings = await fresh();
    const first = await settings.readSettings();
    const startedBefore = settings.readSettings();
    const saved = await settings.saveSettings({ prStatus: false });
    const before = await startedBefore;
    expect(first.read).toBe(1);
    expect(before.read).toBeGreaterThan(first.read);
    expect(saved.view.read).toBeGreaterThan(before.read);
    expect(saved.view.prStatus.value).toBe(false);
  });

  it('keeps what the file last read in force while it does not parse, and drops it once the file is gone', async () => {
    const settings = await fresh();
    writeFileSync(settingsFile, '{ "launchFlags": "--mine" }\n');
    expect((await settings.readSettings()).launchFlags.value).toBe('--mine');
    writeFileSync(settingsFile, '{ "launchFlags": "--mi');
    const broken = await settings.readSettings();
    expect(broken.launchFlags.value).toBe('--mine');
    expect(broken.file).toMatchObject({ status: 'unparsable' });
    await fs.rm(settingsFile);
    expect((await settings.readSettings()).launchFlags).toEqual({ value: '', problem: null });
  });

  it('logs what is wrong once per change, and never a flag’s value', async () => {
    writeFileSync(settingsFile, '{ "launchFlags": "update --secret-value", "lanchFlags": 1 }\n');
    const settings = await fresh();
    await settings.readSettings();
    await settings.readSettings();
    const lines = logged.filter((line) => line.includes(' settings '));
    expect(lines).toEqual(['warn settings settings.json: "lanchFlags" is not a setting the app has.; launchFlags in settings.json is not used, Settings says why']);
    expect(lines.join()).not.toContain('secret');
    writeFileSync(settingsFile, '{}\n');
    await settings.readSettings();
    expect(logged.at(-1)).toBe('info settings the settings file read without a mistake');
  });
});

describe('saving from Settings', () => {
  it('writes settings.json as an edit of its text, keeping what a person wrote there', async () => {
    writeFileSync(settingsFile, '{\n  // mine\n  "launchFlags": "--mine",\n  "prStatus": true\n}\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--allowedTools Grep' });
    expect(saved.refused).toBeNull();
    expect(saved.view.launchFlags).toEqual({ value: '--allowedTools Grep', problem: null });
    expect(await text(settingsFile)).toBe('{\n  // mine\n  "launchFlags": "--allowedTools Grep",\n  "prStatus": true\n}\n');
  });

  it('makes settings.json when there is none, holding only what differs from the default', async () => {
    const settings = await fresh();
    await settings.saveSettings({ launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: false });
    expect(await json(settingsFile)).toEqual({ prStatus: false });
  });

  it('writes nothing for a save that changes nothing', async () => {
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: true });
    expect(saved.refused).toBeNull();
    await gone(settingsFile);
  });

  it('refuses a value the setting may not hold, writing nothing', async () => {
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--resume other' });
    expect(saved.refused).toBe("--resume can't be set here — claude-ui decides which session a tab resumes.");
    await gone(settingsFile);
  });

  it('refuses to write over a settings.json a person left not parsing, saying where it goes wrong', async () => {
    writeFileSync(settingsFile, '{ "launchFlags": "--a"\n "x": 1 }\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--b' });
    expect(saved.refused).toBe('settings.json does not parse, so it was not written: expected a comma at line 2, column 2');
    expect(await text(settingsFile)).toBe('{ "launchFlags": "--a"\n "x": 1 }\n');
  });

  it('names a key settings.json names more than once, and refuses a save that would write it, writing nothing', async () => {
    writeFileSync(settingsFile, '{\n  "prStatus": true,\n  "prStatus": false\n}\n');
    const settings = await fresh();
    const view = await settings.readSettings();
    expect(view.prStatus.value).toBe(false);
    expect(view.notes).toEqual(['settings.json names "prStatus" more than once: the last is the one read, and Settings refuses a save that would change it until only one is left.']);
    const saved = await settings.saveSettings({ prStatus: true });
    expect(saved.refused).toBe('settings.json names "prStatus" more than once, so nothing was saved: leave one of each, then save again.');
    expect(await text(settingsFile)).toBe('{\n  "prStatus": true,\n  "prStatus": false\n}\n');
  });

  it('refuses to write into a settings.json a person left holding no object, saying so', async () => {
    writeFileSync(settingsFile, '[]\n');
    const settings = await fresh();
    const saved = await settings.saveSettings({ launchFlags: '--b' });
    expect(saved.refused).toBe('settings.json has to hold one object, { … }, so it was not written');
    expect(await text(settingsFile)).toBe('[]\n');
  });
});

describe('a new settings.json', () => {
  it('is written by a launch that finds none, every setting at its default under a line saying what it is', async () => {
    const settings = await launch();
    await settings.readSettings();
    expect(await text(settingsFile)).toBe(
      [
        '{',
        '  // Flags added to every session the app starts, as you would type them',
        '  "launchFlags": "",',
        '  // What a launch does with the sessions that were running when the app closed: "start", "pause" or "leave"',
        '  "runningSessionsAtLaunch": "pause",',
        '  // Whether the app asks GitHub, with gh, what it says of the PRs your sessions link, which colours their marks',
        '  "prStatus": true',
        '}',
        '',
      ].join('\n'),
    );
    expect(logged).toContain('info settings settings.json written with every setting at its default, since there was none');
  });

  it('is not written over a settings.json that is there, even one that does not parse', async () => {
    writeFileSync(settingsFile, '{ "prStatus": fals');
    const settings = await launch();
    await settings.readSettings();
    expect(await text(settingsFile)).toBe('{ "prStatus": fals');
  });

  it('is written again at the next launch after settings.json is taken away', async () => {
    let settings = await launch();
    await settings.readSettings();
    await fs.rm(settingsFile);
    settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(true);
    expect(await jsonc(settingsFile)).toEqual(defaults);
  });
});

describe('the move from meta.json', () => {
  const metaWith = (fields: Record<string, unknown>): void => writeFileSync(metaFile, JSON.stringify({ version: 3, appVersion: '0.4.0', ...fields }));

  it('moves the flags an older build kept into settings.json, once, and leaves meta’s copy where it was', async () => {
    metaWith({ settings: { launchFlags: '--allowedTools Grep,Glob' } });
    let settings = await launch();
    expect((await settings.readSettings()).launchFlags.value).toBe('--allowedTools Grep,Glob');
    expect(await jsonc(settingsFile)).toEqual({ ...defaults, launchFlags: '--allowedTools Grep,Glob' });
    expect(((await json(metaFile)) as { settings: unknown }).settings).toEqual({ launchFlags: '--allowedTools Grep,Glob' });
    expect(await moves()).toContain('launchFlags');
    // The flags taken out of settings.json by hand stay out: the next launch must not bring them back.
    await fs.rm(settingsFile);
    settings = await launch();
    expect((await settings.readSettings()).launchFlags.value).toBe('');
  });

  it('leaves alone flags settings.json already holds', async () => {
    metaWith({ settings: { launchFlags: '--old' } });
    writeFileSync(settingsFile, '{ "launchFlags": "--newer" }\n');
    const settings = await launch();
    expect((await settings.readSettings()).launchFlags.value).toBe('--newer');
  });

  it('writes nothing over the starter for the default, and still records the move', async () => {
    metaWith({});
    const settings = await launch();
    await settings.readSettings();
    expect(await jsonc(settingsFile)).toEqual(defaults);
    expect(await moves()).toContain('launchFlags');
  });

  it('replaces default flags the file gives, whether the starter wrote them or a person did', async () => {
    metaWith({ settings: { launchFlags: '--old' } });
    writeFileSync(settingsFile, '{ "launchFlags": "" }\n');
    const settings = await launch();
    expect((await settings.readSettings()).launchFlags.value).toBe('--old');
  });

  it('leaves alone flags settings.json gives that cannot be used', async () => {
    metaWith({ settings: { launchFlags: '--old' } });
    writeFileSync(settingsFile, '{ "launchFlags": 42 }\n');
    const settings = await launch();
    await settings.readSettings();
    expect(await text(settingsFile)).toBe('{ "launchFlags": 42 }\n');
  });
});

describe('the move from settings.local.json', () => {
  const backup = path.join(dataDir, 'backups', 'config', 'settings.local.json.bak');

  it('writes what it holds into settings.json over the file’s own, keeping its comments, and takes it away, its text kept', async () => {
    writeFileSync(settingsFile, '{\n  // mine\n  "launchFlags": "--mine"\n}\n');
    writeFileSync(localFile, '{ "launchFlags": "--app", "prStatus": false }\n');
    const settings = await launch();
    const view = await settings.readSettings();
    expect([view.launchFlags.value, view.prStatus.value]).toEqual(['--app', false]);
    expect(await text(settingsFile)).toContain('// mine');
    await gone(localFile);
    expect(await text(backup)).toBe('{ "launchFlags": "--app", "prStatus": false }\n');
    expect(await moves()).toEqual(['launchFlags', 'settingsLocal']);
  });

  it('leaves out a value it holds that cannot be used', async () => {
    writeFileSync(localFile, '{ "launchFlags": "--resume x", "prStatus": false }\n');
    const settings = await launch();
    await settings.readSettings();
    expect(await jsonc(settingsFile)).toEqual({ ...defaults, prStatus: false });
  });

  it('waits for a launch where settings.json parses, and until then what it holds is not in force', async () => {
    writeFileSync(settingsFile, '{ "launchFlags": "--a"\n "x": 1 }\n');
    writeFileSync(localFile, '{ "prStatus": false }\n');
    let settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(true);
    expect(await text(localFile)).toBe('{ "prStatus": false }\n');
    expect(await moves()).toEqual(['launchFlags']);
    expect(logged).toContain('warn settings settings.json does not parse, so what settings.local.json holds was not moved into it and is not in force; the move is tried again at the next launch');

    writeFileSync(settingsFile, '{}\n');
    settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(false);
    await gone(localFile);
  });

  it('waits for a launch where settings.json names no setting it would write more than once', async () => {
    writeFileSync(settingsFile, '{ "prStatus": true, "prStatus": true }\n');
    writeFileSync(localFile, '{ "prStatus": false }\n');
    let settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(true);
    expect(await text(settingsFile)).toBe('{ "prStatus": true, "prStatus": true }\n');
    expect(await text(localFile)).toBe('{ "prStatus": false }\n');
    expect(logged).toContain('warn settings settings.json names a setting the move would write more than once, so what settings.local.json holds was not moved into it and is not in force; the move is tried again at the next launch');

    writeFileSync(settingsFile, '{ "prStatus": true }\n');
    settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(false);
    await gone(localFile);
  });

  it('waits for a launch where it parses itself', async () => {
    writeFileSync(localFile, '{ "prStatus": false');
    let settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(true);
    expect(await moves()).toEqual(['launchFlags']);
    expect(logged).toContain('warn settings settings.local.json does not parse, so what it holds was not moved into settings.json and is not in force; the move is tried again at the next launch');

    writeFileSync(localFile, '{ "prStatus": false }\n');
    settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(false);
    await gone(localFile);
  });

  it('is made once: a settings.local.json made after it is not read', async () => {
    let settings = await launch();
    await settings.readSettings();
    expect(await moves()).toEqual(['launchFlags', 'settingsLocal']);
    writeFileSync(localFile, '{ "prStatus": false }\n');
    settings = await launch();
    expect((await settings.readSettings()).prStatus.value).toBe(true);
  });
});

describe('telling the window', () => {
  it('pushes the settings when a person edits settings.json, and not after Settings’ own save', async () => {
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
      writeFileSync(settingsFile, '{ "launchFlags": "--mine" }\n');
      await vi.waitFor(() => expect(sent.filter(([channel]) => channel === 'settings:changed')).toHaveLength(1), { timeout: 3000 });
    } finally {
      stop();
    }
  });
});
