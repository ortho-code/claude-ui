import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { promises as fs, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';

// A real folder, so the app's file and meta.json are read back from disk as main reads them.
const { dataDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return { dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-layoutstate-')) };
});

vi.mock('electron', () => ({
  app: { getPath: () => dataDir, setPath: () => {}, getVersion: () => '0.4.0' },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: () => {},
  logOnce: () => {},
}));

import { moveLayoutState, readLocalLayout, setLayoutState } from '../../../src/main/layoutstate';
import { defaultLocalLayoutFile, layoutsDir } from '../../../src/main/paths';

const json = async (): Promise<unknown> => JSON.parse(await fs.readFile(defaultLocalLayoutFile, 'utf8'));
const metaFile = path.join(dataDir, 'meta.json');

beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
  mkdirSync(layoutsDir, { recursive: true });
  writeFileSync(metaFile, JSON.stringify({ version: 3, appVersion: '0.4.0' }));
});
afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe('keeping what the window changed', () => {
  it('writes each field under its node, making the file', async () => {
    expect(await setLayoutState([{ id: 'sidebar', field: 'size', value: '280px' }, { id: 'right', field: 'folded', value: true }])).toEqual({ refused: null });
    expect(await json()).toEqual({ nodes: { sidebar: { size: '280px' }, right: { folded: true } } });
  });

  it('removes a field, and a node left with nothing, keeping a comment a person wrote', async () => {
    writeFileSync(defaultLocalLayoutFile, '{\n  // dragged on the big screen\n  "nodes": { "sidebar": { "size": "280px" }, "right": { "folded": true, "active": "checks" } }\n}\n');
    await setLayoutState([{ id: 'sidebar', field: 'size', value: null }, { id: 'right', field: 'folded', value: null }]);
    const text = await fs.readFile(defaultLocalLayoutFile, 'utf8');
    expect(text).toContain('// dragged on the big screen');
    expect((await readLocalLayout()).json).toEqual({ nodes: { right: { active: 'checks' } } });
  });

  it('refuses a change no node can carry, writing nothing', async () => {
    expect((await setLayoutState([{ id: 'Not An Id', field: 'size', value: 0.3 }])).refused).toBe('"Not An Id" is not a node\'s id.');
    expect((await setLayoutState([{ id: 'right', field: 'colour' as never, value: 'red' }])).refused).toBe('colour is not something the app keeps for a node.');
    expect((await setLayoutState([{ id: 'right', field: 'size', value: 'wide' }])).refused).toBe('size is not a positive number or a pixel size like "320px".');
    await expect(fs.access(defaultLocalLayoutFile)).rejects.toThrow();
  });

  it('refuses to write over a file a person left not parsing, saying where', async () => {
    writeFileSync(defaultLocalLayoutFile, '{ "nodes": {\n  "a" 1 } }\n');
    expect((await setLayoutState([{ id: 'right', field: 'folded', value: true }])).refused).toBe('default.local.json does not parse, so it was not written: expected a colon at line 2, column 7');
  });

  it('applies changes asked for at once in order, each against what the one before left', async () => {
    await Promise.all([setLayoutState([{ id: 'right', field: 'folded', value: true }]), setLayoutState([{ id: 'right', field: 'folded', value: null }]), setLayoutState([{ id: 'drawer', field: 'size', value: 0.3 }])]);
    expect(await json()).toEqual({ nodes: { drawer: { size: 0.3 } } });
  });
});

describe('reading the app’s file', () => {
  it('says whether its text is what the app last wrote, and whether the state from meta.json has moved', async () => {
    expect(await readLocalLayout()).toMatchObject({ status: 'missing', byApp: false, stateMoved: false });
    await setLayoutState([{ id: 'right', field: 'folded', value: true }]);
    expect(await readLocalLayout()).toMatchObject({ status: 'read', byApp: true });
    writeFileSync(defaultLocalLayoutFile, '{ "nodes": { "right": { "folded": false } } }\n');
    expect(await readLocalLayout()).toMatchObject({ status: 'read', byApp: false });
  });
});

describe('the move from meta.json', () => {
  it('writes the nodes once, records the move, and does not make it again', async () => {
    await moveLayoutState({ sidebar: { size: '280px' }, right: { folded: true, active: 'checks' } });
    expect(await json()).toEqual({ nodes: { sidebar: { size: '280px' }, right: { folded: true, active: 'checks' } } });
    expect(((JSON.parse(await fs.readFile(metaFile, 'utf8')) as { moved: string[] }).moved)).toEqual(['panelState']);
    expect((await readLocalLayout()).stateMoved).toBe(true);
    await fs.rm(defaultLocalLayoutFile);
    await moveLayoutState({ sidebar: { size: '300px' } });
    await expect(fs.access(defaultLocalLayoutFile)).rejects.toThrow();
  });

  it('writes nothing over a file that already holds nodes, and still records the move', async () => {
    writeFileSync(defaultLocalLayoutFile, '{ "nodes": { "sidebar": { "size": "250px" } } }\n');
    await moveLayoutState({ sidebar: { size: '280px' } });
    expect(await json()).toEqual({ nodes: { sidebar: { size: '250px' } } });
    expect((await readLocalLayout()).stateMoved).toBe(true);
  });

  it('writes no file when there is nothing to move', async () => {
    await moveLayoutState({});
    await expect(fs.access(defaultLocalLayoutFile)).rejects.toThrow();
    expect((await readLocalLayout()).stateMoved).toBe(true);
  });
});
