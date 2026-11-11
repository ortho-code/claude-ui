import { vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import * as path from 'node:path';

const realOs = await vi.importActual<typeof import('node:os')>('node:os');

/** A throwaway home, so the hook script, its settings and the status files land in a temporary ~/.claude and ~/.config. */
export const testHome = mkdtempSync(path.join(realOs.tmpdir(), 'claude-ui-status-'));

const pinned: Record<string, string> = {};

/**
 * Electron as the status paths ask it.
 * paths.ts pins userData to <appData>/claude-ui on import, so the fake app has to honour setPath for the status paths to land under `testHome`.
 * appData -> <testHome>/.config keeps that the same directory the app uses on Linux.
 */
export const electronStub = {
  app: {
    getPath: (name: string): string => pinned[name] ?? path.join(testHome, name === 'appData' ? '.config' : name),
    setPath: (name: string, value: string): void => {
      pinned[name] = value;
    },
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
};

/** node:os with its home directory at `testHome`. */
export const osStub = { ...realOs, homedir: (): string => testHome };
