import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

const { dataDir, handlers, openPath } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs');
  const { tmpdir } = require('node:os') as typeof import('node:os');
  const { join } = require('node:path') as typeof import('node:path');
  return {
    dataDir: mkdtempSync(join(tmpdir(), 'claude-ui-folders-')),
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    openPath: vi.fn(async () => ''),
  };
});

vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'logs' ? `${dataDir}/logs` : dataDir), setPath: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn),
  },
  shell: { openPath },
}));

import { registerFolders } from '../../../src/main/folders';
import { configRoot, logsDir } from '../../../src/main/paths';

beforeAll(() => registerFolders());
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe('the folders Settings shows', () => {
  it('are the config folder and the logs folder, by name', () => {
    expect(handlers.get('folders:get')!()).toEqual({ config: configRoot, logs: logsDir });
  });

  it('open the folder itself, not its parent with the folder selected', () => {
    openPath.mockClear();
    handlers.get('folder:open')!(null, 'config');
    expect(openPath).toHaveBeenCalledWith(configRoot);
  });

  it('make the logs folder again when it was deleted, so it can still be opened', () => {
    openPath.mockClear();
    rmSync(logsDir, { recursive: true, force: true });
    handlers.get('folder:open')!(null, 'logs');
    expect(existsSync(logsDir)).toBe(true);
    expect(openPath).toHaveBeenCalledWith(logsDir);
  });

  it('open nothing for a name that is not one of them, the prototype\'s included', () => {
    openPath.mockClear();
    for (const name of ['/etc', 'constructor', '__proto__', 'toString']) handlers.get('folder:open')!(null, name);
    expect(openPath).not.toHaveBeenCalled();
  });
});
