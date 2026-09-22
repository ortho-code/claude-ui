import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import * as path from 'node:path';

// A real folder, so the script checks are made against a real filesystem rather than a fake one that agrees with the code.
const { dataDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-config-')) };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  shell: { showItemInFolder: () => {} },
}));

import { readLayout, resolveScript } from './config';
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

  it('checks every script it finds, keyed by the value as written, and words the problem in that value', async () => {
    writeFileSync(path.join(scriptsDir, 'plain.sh'), '#!/bin/sh\n', { mode: 0o644 });
    writeFileSync(path.join(scriptsDir, 'runnable.sh'), '#!/bin/sh\n', { mode: 0o755 });
    mkdirSync(path.join(scriptsDir, 'a dir'), { recursive: true });
    write({
      version: 1,
      sides: {
        right: {
          groups: [
            {
              panels: [
                { id: 'a', type: 'command', script: 'scripts/missing.sh' },
                { id: 'b', type: 'command', script: 'scripts/plain.sh' },
                { id: 'c', type: 'command', script: 'scripts/runnable.sh' },
                { id: 'd', type: 'command', script: 'scripts/a dir' },
                // Not where the validator looks, and a duplicate value: still one check, keyed once.
                { script: 'scripts/runnable.sh', nested: { script: 'scripts/plain.sh' } },
              ],
            },
          ],
        },
      },
    });
    const { scripts } = await readLayout();
    expect(scripts).toEqual({
      'scripts/missing.sh': { path: path.join(scriptsDir, 'missing.sh'), problem: 'scripts/missing.sh not found' },
      'scripts/plain.sh': { path: path.join(scriptsDir, 'plain.sh'), problem: 'scripts/plain.sh is not executable' },
      'scripts/runnable.sh': { path: path.join(scriptsDir, 'runnable.sh'), problem: null },
      'scripts/a dir': { path: path.join(scriptsDir, 'a dir'), problem: 'scripts/a dir is not a file' },
    });
  });

  it('clears a script’s problem once it gains its bit, on the next read', async () => {
    write({ version: 1, sides: { right: { groups: [{ panels: [{ id: 'a', type: 'command', script: 'scripts/plain.sh' }] }] } } });
    expect((await readLayout()).scripts['scripts/plain.sh'].problem).toBe('scripts/plain.sh is not executable');
    chmodSync(path.join(scriptsDir, 'plain.sh'), 0o755);
    expect((await readLayout()).scripts['scripts/plain.sh'].problem).toBeNull();
  });

  it('resolves a relative script against the config folder and leaves an absolute one alone', () => {
    expect(resolveScript('scripts/x.sh')).toBe(path.join(configRoot, 'scripts', 'x.sh'));
    expect(resolveScript('/opt/x')).toBe('/opt/x');
  });
});
