import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
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
  app: { getPath: () => dataDir, setPath: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('./log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { checkPath, noteLayout, readLayout, resolvePath } from './config';
import { configRoot, defaultLayoutFile, scriptsDir } from './paths';

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

  it('reports a file that is not JSON with the parser’s own message and position, and does not throw', async () => {
    write('{\n  "version": 1,\n  "sides": {\n}');
    const report = await readLayout();
    expect(report.status).toBe('unparsable');
    expect(report.error).toMatch(/position \d+/);
    expect(report.json).toBeNull();
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
    expect(Object.keys(await readLayout()).sort()).toEqual(['configRoot', 'error', 'file', 'json', 'status']);
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
    const base = { configRoot, file: '/cfg/layouts/default.json', json: null };
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
});
