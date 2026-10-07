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

import { editAppFile, isAppFile, ownWrites } from '../../../src/main/appfiles';
import { configBackupsDir, configRoot, defaultLayoutFile } from '../../../src/main/paths';

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
  it('is only its own .local.json files, inside the config folder', () => {
    expect(isAppFile(file)).toBe(true);
    expect(isAppFile(path.join(configRoot, 'layouts', 'default.local.json'))).toBe(true);
    expect(isAppFile(path.join(configRoot, 'settings.json'))).toBe(false);
    expect(isAppFile(defaultLayoutFile)).toBe(false);
    expect(isAppFile(path.join(dataDir, 'settings.local.json'))).toBe(false);
    expect(isAppFile(path.join(configRoot, '..', 'elsewhere.local.json'))).toBe(false);
  });

  it('refuses any other file, writing nothing', async () => {
    const yours = path.join(configRoot, 'settings.json');
    writeFileSync(yours, '{ "launchFlags": "--mine" }\n');
    await expect(editAppFile(yours, [{ path: ['launchFlags'], value: '--app' }])).rejects.toThrow(/is not one of the app's own files/);
    expect(await read(yours)).toBe('{ "launchFlags": "--mine" }\n');
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
