import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';

// A real folder, so the script checks are made against a real filesystem rather than a fake one that agrees with the code.
const { dataDir, logged } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-config-')), logged: [] as string[] };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {}, getVersion: () => '0.4.0' },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import type { BrowserWindow } from 'electron';
import { editAppFile } from '../../../src/main/appfiles';
import { checkPath, noteLayout, readLayout, readTypes, registerConfig, resolvePath } from '../../../src/main/config';
import { configRoot, defaultLayoutFile, scriptsDir, typesDir } from '../../../src/main/paths';
import type { TypeReport } from '../../../src/shared/panels';

const write = (json: unknown): void => writeFileSync(defaultLayoutFile, typeof json === 'string' ? json : JSON.stringify(json));

beforeAll(() => {
  mkdirSync(path.dirname(defaultLayoutFile), { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
});
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('readLayout', () => {
  it('reports a missing file as missing, not as an error', async () => {
    rmSync(defaultLayoutFile, { force: true });
    expect(await readLayout()).toMatchObject({ status: 'missing', error: null, json: null, file: defaultLayoutFile, configRoot });
  });

  it('reports a file that does not parse with what is wrong and where, and does not throw', async () => {
    write('{\n  "version": 1\n  "sides": {}\n}');
    expect(await readLayout()).toMatchObject({ status: 'unparsable', error: 'expected a comma at line 3, column 3', json: null });
    write('{\n  "version": 1,\n  "sides": {\n}');
    expect(await readLayout()).toMatchObject({ status: 'unparsable', error: 'expected a closing } at the end of the file', json: null });
  });

  it('reads comments and trailing commas', async () => {
    write('{\n  // the window\n  "version": 2, /* for now */\n  "root": { "id": "w", "panels": [{ "id": "a", "type": "claude" },] },\n}\n');
    expect(await readLayout()).toMatchObject({ status: 'read', error: null, json: { version: 2, root: { id: 'w', panels: [{ id: 'a', type: 'claude' }] } } });
  });

  it('reads past a byte-order mark an editor left', async () => {
    write('﻿{"version": 1, "sides": {}}');
    expect(await readLayout()).toMatchObject({ status: 'read', json: { version: 1, sides: {} } });
  });

  it('hands the parsed file over as it is, without validating its shape', async () => {
    write({ version: 99, whatever: [1, 2] });
    expect(await readLayout()).toMatchObject({ status: 'read', json: { version: 99, whatever: [1, 2] } });
  });

  it('checks nothing a panel’s options point at: that is the panel’s to ask', async () => {
    write({ version: 2, root: { id: 'w', panels: [{ id: 'a', type: 'command', options: { script: 'scripts/missing.sh' } }] } });
    expect(Object.keys(await readLayout()).sort()).toEqual(['configRoot', 'error', 'file', 'json', 'status', 'types']);
  });
});

describe('readTypes', () => {
  const folder = (name: string, manifest?: string): void => {
    mkdirSync(path.join(typesDir, name), { recursive: true });
    if (manifest !== undefined) writeFileSync(path.join(typesDir, name, 'panel.json'), manifest);
  };

  beforeAll(() => {
    folder('reviews', '{\n  // what the type is\n  "version": 1,\n  "kind": "list",\n}');
    folder('broken', '{"version": 1,');
    folder('empty');
    folder('bom', '﻿{"version": 1}');
    folder('.git');
    writeFileSync(path.join(typesDir, 'notes.txt'), 'not a folder');
    mkdirSync(path.join(dataDir, 'elsewhere', 'linked'), { recursive: true });
    writeFileSync(path.join(dataDir, 'elsewhere', 'linked', 'panel.json'), '{"version": 1}');
    symlinkSync(path.join(dataDir, 'elsewhere', 'linked'), path.join(typesDir, 'linked'));
  });

  it('reads every folder’s manifest as it is, in name order, each named after its folder', async () => {
    const reports = await readTypes();
    expect(reports.map(({ name }) => name)).toEqual(['bom', 'broken', 'empty', 'linked', 'reviews']);
    expect(reports.find(({ name }) => name === 'reviews')).toEqual({
      name: 'reviews',
      dir: path.join(typesDir, 'reviews'),
      status: 'read',
      error: null,
      json: { version: 1, kind: 'list' },
    });
  });

  it('says a folder without a manifest is missing one, and one that does not parse what is wrong and where', async () => {
    const reports = await readTypes();
    expect(reports.find(({ name }) => name === 'empty')).toMatchObject({ status: 'missing', error: null, json: null });
    expect(reports.find(({ name }) => name === 'broken')).toMatchObject({ status: 'unparsable', error: 'expected a property name in double quotes at the end of the file', json: null });
    expect(reports.find(({ name }) => name === 'bom')).toMatchObject({ status: 'read', json: { version: 1 } });
  });

  it('follows a linked folder, and skips dot-folders and files', async () => {
    const reports = await readTypes();
    expect(reports.find(({ name }) => name === 'linked')).toMatchObject({ status: 'read', json: { version: 1 } });
    expect(reports.map(({ name }) => name)).not.toContain('.git');
    expect(reports.map(({ name }) => name)).not.toContain('notes.txt');
  });

  it('is empty without a types folder, and is part of every read of the layout', async () => {
    expect(await readTypes(path.join(dataDir, 'nowhere'))).toEqual([]);
    expect((await readLayout()).types.map(({ name }) => name)).toContain('reviews');
  });
});

describe('resolvePath', () => {
  it('resolves a relative value against its base, the config folder or a folder the panel names', () => {
    expect(resolvePath('scripts/x.sh', 'config')).toBe(path.join(configRoot, 'scripts', 'x.sh'));
    expect(resolvePath('packages/api', { dir: '/repo' })).toBe('/repo/packages/api');
    expect(resolvePath('../up', { dir: '/repo/sub' })).toBe('/repo/up');
  });

  it('leaves an absolute value alone, whatever the base', () => {
    expect(resolvePath('/opt/x', 'config')).toBe('/opt/x');
    expect(resolvePath('/opt/x', { dir: '/repo' })).toBe('/opt/x');
  });

  it('expands ~ and ~/ to the home directory, so a shared layout file works on another machine', () => {
    expect(resolvePath('~', 'config')).toBe(homedir());
    expect(resolvePath('~/bin/status', { dir: '/repo' })).toBe(path.join(homedir(), 'bin', 'status'));
  });
});

describe('checkPath', () => {
  beforeAll(() => {
    writeFileSync(path.join(scriptsDir, 'plain.sh'), '#!/bin/sh\n', { mode: 0o644 });
    writeFileSync(path.join(scriptsDir, 'runnable.sh'), '#!/bin/sh\n', { mode: 0o755 });
    mkdirSync(path.join(scriptsDir, 'a dir'), { recursive: true });
  });

  it('words every problem in the value as written, and hands back where it resolved', async () => {
    expect(await checkPath('scripts/missing.sh', 'config', 'executable')).toEqual({ path: path.join(scriptsDir, 'missing.sh'), problem: 'scripts/missing.sh not found' });
    expect(await checkPath('scripts/plain.sh', 'config', 'executable')).toEqual({ path: path.join(scriptsDir, 'plain.sh'), problem: 'scripts/plain.sh is not executable' });
    expect(await checkPath('scripts/a dir', 'config', 'executable')).toEqual({ path: path.join(scriptsDir, 'a dir'), problem: 'scripts/a dir is not a file' });
    expect(await checkPath('scripts/runnable.sh', 'config', 'executable')).toEqual({ path: path.join(scriptsDir, 'runnable.sh'), problem: null });
  });

  it('asks a folder to be a folder', async () => {
    expect(await checkPath('a dir', { dir: scriptsDir }, 'directory')).toEqual({ path: path.join(scriptsDir, 'a dir'), problem: null });
    expect((await checkPath('runnable.sh', { dir: scriptsDir }, 'directory')).problem).toBe('runnable.sh is not a folder');
    expect((await checkPath('nowhere', { dir: scriptsDir }, 'directory')).problem).toBe('nowhere not found');
  });

  it('clears a script’s problem once it gains its bit, on the next check', async () => {
    writeFileSync(path.join(scriptsDir, 'later.sh'), '#!/bin/sh\n', { mode: 0o644 });
    expect((await checkPath('scripts/later.sh', 'config', 'executable')).problem).toBe('scripts/later.sh is not executable');
    chmodSync(path.join(scriptsDir, 'later.sh'), 0o755);
    expect((await checkPath('scripts/later.sh', 'config', 'executable')).problem).toBeNull();
  });
});

describe('noteLayout', () => {
  it('logs the layout file only when what a read found changes', () => {
    logged.length = 0;
    const base = { configRoot, file: '/cfg/layouts/default.json', json: null, types: [] };
    noteLayout({ ...base, status: 'missing', error: null });
    noteLayout({ ...base, status: 'missing', error: null });
    noteLayout({ ...base, status: 'unparsable', error: 'Unexpected token } at position 12' });
    noteLayout({ ...base, status: 'read', error: null, json: {} });
    noteLayout({ ...base, status: 'read', error: null, json: { changed: true } });
    expect(logged).toEqual([
      'info layout /cfg/layouts/default.json: not there, the default layout is shown',
      'warn layout /cfg/layouts/default.json: does not parse, the last good layout stays up: Unexpected token } at position 12',
      'info layout /cfg/layouts/default.json: read',
    ]);
  });

  it('logs the type folders when which there are, or whether each could be read, changes', () => {
    logged.length = 0;
    const base = { configRoot, file: '/cfg/layouts/default.json', status: 'read' as const, error: null, json: {} };
    const type = (name: string, over: Partial<TypeReport> = {}): TypeReport => ({ name, dir: `/cfg/types/${name}`, status: 'read', error: null, json: {}, ...over });
    noteLayout({ ...base, types: [type('reviews')] });
    noteLayout({ ...base, types: [type('reviews', { json: { changed: true } })] });
    noteLayout({ ...base, types: [type('reviews'), type('ci', { status: 'unparsable', error: 'Unexpected end of JSON input' }), type('bare', { status: 'missing' })] });
    noteLayout({ ...base, types: [] });
    noteLayout({ ...base, types: [] });
    expect(logged.filter((line) => line.includes('types:'))).toEqual([
      'info layout types: reviews',
      'warn layout types: reviews, ci (panel.json does not parse: Unexpected end of JSON input), bare (no panel.json)',
      'info layout types: none',
    ]);
  });
});

describe('the watch on the config folder', () => {
  it('pushes nothing for the app’s own write to one of its files, and pushes a person’s edit of the same file', async () => {
    const sent: unknown[] = [];
    const window = { isDestroyed: () => false, webContents: { send: (_channel: string, report: unknown) => sent.push(report) } };
    const stop = registerConfig(() => window as unknown as BrowserWindow);
    const file = path.join(configRoot, 'settings.local.json');
    try {
      await editAppFile(file, [{ path: ['launchFlags'], value: '--a' }]);
      // A push comes 300 ms after the last event: well past that, there has been none.
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(sent).toEqual([]);
      writeFileSync(file, '{ "launchFlags": "--edited" }\n');
      await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 3000 });
    } finally {
      stop();
    }
  });
});
