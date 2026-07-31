import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// A temp HOME so installStatusHooks writes into a throwaway ~/.claude and ~/.config. Created in
// vi.hoisted so it exists before the node:os mock (which closes over it) and before status.ts loads.
const { testHome } = vi.hoisted(() => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-status-')) as string };
});

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() }, BrowserWindow: class {} }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testHome };
});

import { installStatusHooks, statusSettingsFile } from './status';

const settingsPath = path.join(testHome, '.claude', 'settings.json');
const ourCmd = path.join(testHome, '.config', 'claude-ui', 'status-hook.sh');
const foreignPromptHook = { hooks: [{ type: 'command', command: '/somewhere/my-own-hook.sh' }] };
const foreignPreTool = { hooks: [{ type: 'command', command: '/somewhere/commit-style.sh' }] };

async function writeSettings(value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(value, null, 2));
}
async function readSettings(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(settingsPath, 'utf8'));
}

beforeEach(async () => {
  await fs.rm(settingsPath, { force: true });
});

describe('installStatusHooks', () => {
  it('writes the status hooks into the tool-owned settings file, not the user settings', async () => {
    await installStatusHooks();
    const tool = JSON.parse(await fs.readFile(statusSettingsFile, 'utf8'));
    expect(Object.keys(tool.hooks).sort()).toEqual(['Notification', 'SessionEnd', 'Stop', 'UserPromptSubmit']);
    expect(tool.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`${ourCmd} busy`);
  });

  it('strips only the previously-injected status hooks from ~/.claude/settings.json', async () => {
    await writeSettings({
      model: 'sonnet',
      hooks: {
        // ours + a foreign hook on the same event: keep the foreign one.
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${ourCmd} busy` }] }, foreignPromptHook],
        // only ours: the event key goes away entirely.
        Stop: [{ hooks: [{ type: 'command', command: `${ourCmd} idle` }] }],
        // unrelated event we never touch.
        PreToolUse: [foreignPreTool],
      },
    });

    await installStatusHooks();
    const after = await readSettings();

    expect(after.model).toBe('sonnet');
    expect((after.hooks as Record<string, unknown>).UserPromptSubmit).toEqual([foreignPromptHook]);
    expect((after.hooks as Record<string, unknown>).Stop).toBeUndefined();
    expect((after.hooks as Record<string, unknown>).PreToolUse).toEqual([foreignPreTool]);
    // Preserve the trailing newline so the cleanup leaves no spurious "no newline" diff.
    expect(await fs.readFile(settingsPath, 'utf8')).toMatch(/}\n$/);
  });

  it('is idempotent: a second run leaves the cleaned user settings unchanged', async () => {
    await writeSettings({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: 'command', command: `${ourCmd} busy` }] }, foreignPromptHook],
      },
    });
    await installStatusHooks();
    const once = await fs.readFile(settingsPath, 'utf8');
    await installStatusHooks();
    const twice = await fs.readFile(settingsPath, 'utf8');
    expect(twice).toBe(once);
  });

  it('does not create ~/.claude/settings.json when there is none to clean', async () => {
    await installStatusHooks();
    await expect(fs.access(settingsPath)).rejects.toThrow();
    // The tool settings file is still written.
    await expect(fs.access(statusSettingsFile)).resolves.toBeUndefined();
  });
});
