import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { promises as fs, writeFileSync } from 'node:fs';
import * as path from 'node:path';

// A real folder, so what is written is read back from disk rather than from a fake that agrees with the code.
const { dataDir, running } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-appfiles-')), running: { version: '0.4.0' } };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {}, getVersion: () => running.version },
}));

import { editAppFile, isAppFile, ownWrites, removeAppFile, startAppFile } from '../../../src/main/appfiles';
import { configBackupsDir, configRoot, defaultLayoutFile, settingsFile } from '../../../src/main/paths';

const file = path.join(configRoot, 'settings.local.json');
const backups = path.join(configBackupsDir, 'settings.local.json');
const read = (at: string): Promise<string> => fs.readFile(at, 'utf8');

beforeEach(async () => {
  running.version = '0.4.0';
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(configRoot, { recursive: true });
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('which files the app may write', () => {
  it('is its own .local.json files inside the config folder, and settings.json', () => {
    expect(isAppFile(file)).toBe(true);
    expect(isAppFile(path.join(configRoot, 'layouts', 'default.local.json'))).toBe(true);
    expect(isAppFile(settingsFile)).toBe(true);
    expect(isAppFile(defaultLayoutFile)).toBe(false);
    expect(isAppFile(path.join(dataDir, 'settings.local.json'))).toBe(false);
    expect(isAppFile(path.join(dataDir, 'settings.json'))).toBe(false);
    expect(isAppFile(path.join(configRoot, '..', 'elsewhere.local.json'))).toBe(false);
  });

  it('refuses any other file, writing nothing', async () => {
    await fs.mkdir(path.dirname(defaultLayoutFile), { recursive: true });
    writeFileSync(defaultLayoutFile, '{ "version": 2 }\n');
    await expect(editAppFile(defaultLayoutFile, [{ path: ['version'], value: 3 }])).rejects.toThrow(/is not a file the app writes/);
    expect(await read(defaultLayoutFile)).toBe('{ "version": 2 }\n');
  });
});

describe('starting a file the app writes', () => {
  it('writes it when there is none, and says so', async () => {
    expect(await startAppFile(settingsFile, '{}\n')).toBe(true);
    expect(await read(settingsFile)).toBe('{}\n');
  });

  it('marks the version that wrote it, so the first edit by a later version keeps the file as this one left it', async () => {
    await startAppFile(settingsFile, '{}\n');
    running.version = '0.5.0';
    await editAppFile(settingsFile, [{ path: ['prStatus'], value: false }]);
    expect(await read(path.join(configBackupsDir, 'settings.json.0.4.0.bak'))).toBe('{}\n');
  });

  it('leaves one that is there as it is, whatever it holds', async () => {
    writeFileSync(settingsFile, '{ "prStatus": fals');
    expect(await startAppFile(settingsFile, '{}\n')).toBe(false);
    expect(await read(settingsFile)).toBe('{ "prStatus": fals');
  });

  it('refuses a file the app does not write', async () => {
    await expect(startAppFile(defaultLayoutFile, '{}\n')).rejects.toThrow(/is not a file the app writes/);
    await expect(fs.access(defaultLayoutFile)).rejects.toThrow();
  });
});

describe('taking one of the app’s own files away', () => {
  it('keeps its text as its previous good copy, then removes it', async () => {
    writeFileSync(file, '{ "prStatus": false }\n');
    await removeAppFile(file);
    await expect(fs.access(file)).rejects.toThrow();
    expect(await read(`${backups}.bak`)).toBe('{ "prStatus": false }\n');
  });

  it('does nothing for one that is not there', async () => {
    await expect(removeAppFile(file)).resolves.toBeUndefined();
    await expect(fs.access(`${backups}.bak`)).rejects.toThrow();
  });

  it('refuses settings.json, which is a person’s file the app only writes into', async () => {
    writeFileSync(settingsFile, '{}\n');
    await expect(removeAppFile(settingsFile)).rejects.toThrow(/is not one of the app's own files/);
    expect(await read(settingsFile)).toBe('{}\n');
  });
});

describe('editing one of the app’s files', () => {
  it('makes the file when it is not there', async () => {
    await editAppFile(file, [{ path: ['launchFlags'], value: '--allowedTools Grep,Glob' }]);
    expect(await read(file)).toBe('{\n  "launchFlags": "--allowedTools Grep,Glob"\n}\n');
  });

  it('changes a value and keeps every comment and the formatting around it', async () => {
    writeFileSync(file, '{\n  // set in Settings\n  "launchFlags": "--a", // trailing\n  /* kept */\n  "other": 1,\n}\n');
    await editAppFile(file, [{ path: ['launchFlags'], value: '--b' }]);
    expect(await read(file)).toBe('{\n  // set in Settings\n  "launchFlags": "--b", // trailing\n  /* kept */\n  "other": 1,\n}\n');
  });

  it('adds and removes keys, a removal taking the comment at the end of the line before along, as measured', async () => {
    writeFileSync(file, '{\n  "launchFlags": "--a", // trailing\n  "other": 1\n}\n');
    await editAppFile(file, [
      { path: ['nodes', 'drawer', 'size'], value: 0.25 },
      { path: ['other'], value: undefined },
    ]);
    expect(await read(file)).toBe('{\n  "launchFlags": "--a",\n  "nodes": {\n    "drawer": {\n      "size": 0.25\n    }\n  }\n}\n');
  });

  it('applies two edits asked for at once in the order they were asked', async () => {
    const first = editAppFile(file, [{ path: ['launchFlags'], value: '--first' }]);
    const second = editAppFile(file, [{ path: ['launchFlags'], value: '--second' }]);
    await Promise.all([first, second]);
    expect(JSON.parse(await read(file))).toEqual({ launchFlags: '--second' });
  });

  it('will not write over a file a person left not parsing, and says where it goes wrong', async () => {
    writeFileSync(file, '{\n  "launchFlags": "--a"\n  "other": 1\n}\n');
    await expect(editAppFile(file, [{ path: ['launchFlags'], value: '--b' }])).rejects.toThrow('settings.local.json does not parse, so it was not written: expected a comma at line 3, column 3');
    expect(await read(file)).toBe('{\n  "launchFlags": "--a"\n  "other": 1\n}\n');
  });

  // Why Settings refuses a save of a key settings.json names twice: the parser reads the last.
  it('edits the first of a key the file names twice', async () => {
    writeFileSync(file, '{ "launchFlags": "--a", "launchFlags": "--b" }\n');
    await editAppFile(file, [{ path: ['launchFlags'], value: '--c' }]);
    expect(await read(file)).toBe('{ "launchFlags": "--c", "launchFlags": "--b" }\n');
  });

  it('will not write into a file a person left holding no object, and says so', async () => {
    for (const held of ['[]\n', 'null\n', '"x"\n']) {
      writeFileSync(file, held);
      await expect(editAppFile(file, [{ path: ['launchFlags'], value: '--b' }])).rejects.toThrow('settings.local.json has to hold one object, { … }, so it was not written');
      expect(await read(file)).toBe(held);
    }
  });

  it('writes nothing, and takes no copy, for a change that leaves the text as it was', async () => {
    writeFileSync(file, '{ "launchFlags": "--a" }\n');
    await editAppFile(file, [{ path: ['launchFlags'], value: '--a' }]);
    await expect(fs.access(`${backups}.bak`)).rejects.toThrow();
  });

  it('keeps line endings a person’s editor wrote', async () => {
    writeFileSync(file, '{\r\n  "launchFlags": "--a"\r\n}\r\n');
    await editAppFile(file, [{ path: ['other'], value: 1 }]);
    expect(await read(file)).toBe('{\r\n  "launchFlags": "--a",\r\n  "other": 1\r\n}\r\n');
  });
});

describe('the copies of the app’s files', () => {
  it('keeps the previous good copy outside the config folder', async () => {
    await editAppFile(file, [{ path: ['launchFlags'], value: '--a' }]);
    await editAppFile(file, [{ path: ['launchFlags'], value: '--b' }]);
    expect(JSON.parse(await read(`${backups}.bak`))).toEqual({ launchFlags: '--a' });
    expect((await fs.readdir(configRoot)).sort()).toEqual(['settings.local.json']);
  });

  it('keeps the file as the outgoing version left it, once, the first time a new version writes', async () => {
    running.version = '0.3.0';
    await editAppFile(file, [{ path: ['launchFlags'], value: '--by-0.3.0' }]);
    running.version = '0.4.0';
    await editAppFile(file, [{ path: ['launchFlags'], value: '--by-0.4.0' }]);
    await editAppFile(file, [{ path: ['launchFlags'], value: '--again' }]);
    expect(JSON.parse(await read(`${backups}.0.3.0.bak`))).toEqual({ launchFlags: '--by-0.3.0' });
    expect((await fs.readdir(configBackupsDir)).sort()).toEqual(['settings.local.json.0.3.0.bak', 'settings.local.json.bak', 'settings.local.json.version']);
  });

  it('takes no version copy of a file no version is known to have written', async () => {
    writeFileSync(file, '{ "launchFlags": "--by-hand" }\n');
    await editAppFile(file, [{ path: ['launchFlags'], value: '--b' }]);
    expect((await fs.readdir(configBackupsDir)).sort()).toEqual(['settings.local.json.bak', 'settings.local.json.version']);
  });
});

describe('telling the app’s own write from a person’s', () => {
  it('is the app’s while the file holds what it last wrote, its temp file included', async () => {
    await editAppFile(file, [{ path: ['launchFlags'], value: '--a' }]);
    expect(await ownWrites([file])).toBe(true);
    expect(await ownWrites([file, `${file}.tmp`])).toBe(true);
  });

  it('is a person’s once the file changed after it, or for any other file', async () => {
    await editAppFile(file, [{ path: ['launchFlags'], value: '--a' }]);
    expect(await ownWrites([file, defaultLayoutFile])).toBe(false);
    writeFileSync(file, '{ "launchFlags": "--edited" }\n');
    expect(await ownWrites([file])).toBe(false);
  });
});
