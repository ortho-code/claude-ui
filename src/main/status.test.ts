import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

// A temp HOME so installStatusHooks writes into a throwaway ~/.claude and ~/.config. Created in vi.hoisted so it exists before the node:os mock (which closes over it) and before status.ts loads.
const { testHome } = vi.hoisted(() => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-status-')) as string };
});

// paths.ts pins userData to <appData>/claude-ui on import, so the fake app has to honour setPath for the status paths to land where this test looks for them.
// appData -> <testHome>/.config keeps that the same directory the app uses on Linux.
vi.mock('electron', () => {
  const nodePath = require('node:path');
  const pinned: Record<string, string> = {};
  return {
    app: {
      getPath: (name: string) => pinned[name] ?? nodePath.join(testHome, name === 'appData' ? '.config' : name),
      setPath: (name: string, value: string) => {
        pinned[name] = value;
      },
    },
    ipcMain: { handle: vi.fn(), on: vi.fn() },
    BrowserWindow: class {},
  };
});
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testHome };
});

import { installStatusHooks, readAllStatuses as getAllStatuses, statusSettingsFile } from './status';
import { hookScriptPath, statusDir } from './paths';

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
    expect(Object.keys(tool.hooks).sort()).toEqual([
      'Notification',
      'PostToolUse',
      'PreCompact',
      'SessionEnd',
      'SessionStart',
      'Stop',
      'UserPromptSubmit',
    ]);
    // PostToolUse is what ends the waiting a permission prompt starts: approving one fires nothing else, so without it the dot stays on waiting for the rest of the turn.
    expect(tool.hooks.PostToolUse[0].hooks[0].command).toBe(`'${ourCmd}' busy`);
    // The script path is single-quoted: on macOS it lives under "Application Support" and an unquoted space would split it into two arguments.
    expect(tool.hooks.UserPromptSubmit[0].hooks[0].command).toBe(`'${ourCmd}' busy`);
    // Compaction is work: busy while it runs, and its END arrives as a SessionStart the script turns into idle.
    expect(tool.hooks.PreCompact[0].hooks[0].command).toBe(`'${ourCmd}' busy`);
    expect(tool.hooks.SessionStart[0].hooks[0].command).toBe(`'${ourCmd}' start`);
  });

  // The cleanup scans every event in the user's file rather than the ones registered now, so an entry left by a version that hooked something this one does not is still found.
  it('strips an injected hook on an event this version does not register', async () => {
    await writeSettings({
      hooks: {
        SubagentStop: [{ hooks: [{ type: 'command', command: `${ourCmd} idle` }] }, foreignPromptHook],
      },
    });
    await installStatusHooks();
    expect(((await readSettings()).hooks as Record<string, unknown>).SubagentStop).toEqual([foreignPromptHook]);
  });

  // The commands here are deliberately UNQUOTED: the entries being cleaned up were written by versions that did not quote the script path, which is why the matcher uses `includes`.
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

/**
 * The hook script is the only part of the app that runs outside it, in a shell Claude Code starts, and none of it was covered before.
 * These run the real script the way Claude Code does — argument, JSON on stdin, `CLAUDE_UI` set — and read the file it leaves behind.
 */
describe('the hook script', () => {
  const SID = '0a945f9c-209b-4758-bf8e-30474af5826c';
  const statusFile = path.join(statusDir, `${SID}.json`);

  const TOKEN = 'tab-token-1';

  /** Run the script as Claude Code would. `scoped` false drops CLAUDE_UI, standing in for a session started in a plain terminal. */
  function runHook(status: string, payload: Record<string, unknown>, scoped = true): void {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH, CLAUDE_UI_TAB: TOKEN };
    delete env.CLAUDE_UI;
    if (scoped) env.CLAUDE_UI = '1';
    execFileSync('bash', [hookScriptPath, status], { input: JSON.stringify(payload), env });
  }
  async function readStatusFile(): Promise<{ status?: string; tab?: string } | null> {
    try {
      return JSON.parse(await fs.readFile(statusFile, 'utf8'));
    } catch {
      return null;
    }
  }

  beforeEach(async () => {
    await installStatusHooks();
    await fs.rm(statusFile, { force: true });
  });

  it('writes the status it is given for the session on stdin', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    expect((await readStatusFile())?.status).toBe('busy');
  });

  it('writes nothing at all for a session claude-ui did not start', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' }, false);
    expect(await readStatusFile()).toBe(null);
  });

  it('reports which terminal the session is running in', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    expect((await readStatusFile())?.tab).toBe(TOKEN);
  });

  /**
   * EVERY reason, `clear` and `resume` included. Those two leave the PROCESS running, which is what made them look like exceptions — but they end the session this event NAMES and start a different one, and this app tracks sessions.
   * Declining to write for them was tried and reverted: it left the finished session showing a live dot for good.
   */
  it.each(['clear', 'resume', 'logout', 'prompt_input_exit', 'other'])(
    'closes the session it names when SessionEnd says %s',
    async (reason) => {
      runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
      runHook('closed', { session_id: SID, hook_event_name: 'SessionEnd', reason });
      expect((await readStatusFile())?.status).toBe('closed');
    },
  );

  it('closes the session when SessionEnd carries no reason', async () => {
    runHook('closed', { session_id: SID, hook_event_name: 'SessionEnd' });
    expect((await readStatusFile())?.status).toBe('closed');
  });

  // A compaction ending is the one SessionStart that means a STATE, and it has to beat the guard below because the session already has a status — the busy that PreCompact set.
  it('turns the end of a compaction into idle, over a live status', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'PreCompact' });
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'compact' });
    expect((await readStatusFile())?.status).toBe('idle');
  });

  // Every other SessionStart is identity only. Writing it over a real status would hollow a live dot, and the wrong answer would then be seeded at the next launch.
  it.each(['clear', 'resume', 'startup'])('never overwrites a status when SessionStart says %s', async (source) => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source });
    expect((await readStatusFile())?.status).toBe('busy');
  });

  // The case the identity marker exists for: a session nothing has reported on yet, which is how a tab learns the id that replaced its own after a /clear.
  it('records a session it has never seen before', async () => {
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'clear' });
    const written = await readStatusFile();
    expect(written?.status).toBe('start');
    expect(written?.tab).toBe(TOKEN);
  });

  // ...but it is identity, not a state, so it must not come back as one at the next launch: nothing renders it, and the dot's tooltip would show the raw word "start".
  it('is not seeded as a status at launch', async () => {
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'clear' });
    expect(await getAllStatuses()).not.toHaveProperty(SID);
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    expect(await getAllStatuses()).toHaveProperty(SID, 'busy');
  });

  // `source` belongs to SessionStart alone: one riding along on any other event must not rewrite its status.
  it('ignores a source on an event that is not a SessionStart', async () => {
    runHook('waiting', { session_id: SID, hook_event_name: 'Notification', source: 'compact' });
    expect((await readStatusFile())?.status).toBe('waiting');
  });
});
