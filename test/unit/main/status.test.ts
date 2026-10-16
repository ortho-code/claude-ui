import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// A temp HOME so installStatusHooks writes into a throwaway ~/.claude and ~/.config.
// Created in vi.hoisted so it exists before the node:os mock (which closes over it) and before status.ts loads.
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

import { installStatusHooks, readAllStatuses as getAllStatuses, readReport, reportEnd, statusSettingsFile, type Ending, type Report, type Work } from '../../../src/main/status';
import { statusDir } from '../../../src/main/paths';
import { runHook, TOKEN } from './hookscript';

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
      'PermissionRequest',
      'PostModelSwitch',
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
    // A permission prompt is waiting from the moment claude asks, not from its notice six seconds later.
    expect(tool.hooks.PermissionRequest[0].hooks[0].command).toBe(`'${ourCmd}' waiting`);
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

  async function readStatusFile(): Promise<{ status?: string; tab?: string; event?: string; background?: string[] } | null> {
    try {
      return JSON.parse(await fs.readFile(statusFile, 'utf8'));
    } catch {
      return null;
    }
  }

  beforeEach(async () => {
    await installStatusHooks();
    await fs.rm(statusFile, { force: true });
    await fs.rm(path.join(statusDir, `${SID}.model`), { force: true });
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

  // Busy is several events, and one of them alone — a prompt submitted — says a session asked to leave has stayed.
  it('names the event that reported the status', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'UserPromptSubmit' });
    runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'PostToolUse' });
  });

  /**
   * EVERY reason, `clear` and `resume` included.
   * Those two leave the PROCESS running, which is what made them look like exceptions — but they end the session this event NAMES and start a different one, and this app tracks sessions.
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

  // Every other SessionStart is identity only.
  // Writing it over a real status would hollow a live dot, and the wrong answer would then be seeded at the next launch.
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

  /**
   * A model switch is the one report that is neither a state nor an identity, so it goes to a file of its own.
   * A transcript only records which model ANSWERED, which is why this is the only place the answer exists at the moment it becomes true.
   */
  it('records a model switch beside the status, without disturbing it', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    runHook('model', {
      session_id: SID,
      hook_event_name: 'PostModelSwitch',
      from_model: 'claude-opus-5',
      to_model: 'claude-sonnet-5',
    });
    expect(await fs.readFile(path.join(statusDir, `${SID}.model`), 'utf8')).toBe('claude-sonnet-5');
    // The session is still working; a switch says nothing about that.
    expect((await readStatusFile())?.status).toBe('busy');
  });

  it('writes no model file when the event names no model to switch to', async () => {
    runHook('model', { session_id: SID, hook_event_name: 'PostModelSwitch', from_model: 'claude-opus-5' });
    await expect(fs.access(path.join(statusDir, `${SID}.model`))).rejects.toThrow();
  });

  // The payload claude 2.1.289 sends as a permission prompt appears, reduced to what matters here.
  it('writes waiting when claude asks for permission, naming the event', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
    runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'WebFetch', tool_input: { url: 'https://example.com' }, permission_mode: 'default', permission_suggestions: [] });
    expect(await readStatusFile()).toMatchObject({ status: 'waiting', event: 'PermissionRequest' });
  });

  // The prompt's own notice, about six seconds later (measured), asks nothing new, and writing it would take a read mark off.
  it("writes nothing for a permission prompt's notice over the waiting its request wrote", async () => {
    runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'WebFetch' });
    runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' });
    expect(await readStatusFile()).toMatchObject({ status: 'waiting', event: 'PermissionRequest' });
  });

  // A claude that sends no PermissionRequest leaves the notice as the only word of the prompt.
  it("still writes waiting for a permission prompt's notice over busy", async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
    runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' });
    expect(await readStatusFile()).toMatchObject({ status: 'waiting', event: 'Notification' });
  });

  // `source` belongs to SessionStart alone: one riding along on any other event must not rewrite its status.
  it('ignores a source on an event that is not a SessionStart', async () => {
    runHook('waiting', { session_id: SID, hook_event_name: 'Notification', source: 'compact' });
    expect((await readStatusFile())?.status).toBe('waiting');
  });

  /**
   * `Stop` lists the work still running behind the turn it ends (`background_tasks`), in the shape claude 2.1.289 was measured to send it.
   * Work still running means the session has not finished, so the dot says so in idle's place.
   */
  describe('a turn that ends with work still running behind it', () => {
    const task = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      id: `task-${type}`,
      type,
      status: 'running',
      description: `a ${type}`,
      ...extra,
    });
    const stop = (extra: Record<string, unknown>): Record<string, unknown> => ({
      session_id: SID,
      hook_event_name: 'Stop',
      stop_hook_active: false,
      last_assistant_message: 'Started.',
      ...extra,
    });

    it('reports background in place of idle, naming what runs', async () => {
      runHook('idle', stop({ background_tasks: [task('shell', { command: 'sleep 20' }), task('subagent', { agent_type: 'general-purpose' })], session_crons: [] }));
      expect(await readStatusFile()).toMatchObject({ status: 'background', event: 'Stop', background: ['shell', 'subagent'] });
    });

    // Read back at launch as the state it is; what ran comes only with a status event.
    it('is read back at launch as background', async () => {
      runHook('idle', stop({ background_tasks: [task('shell')] }));
      expect(await getAllStatuses()).toHaveProperty(SID, 'background');
    });

    it('names a type of work it has not heard of as claude labels it', async () => {
      runHook('idle', stop({ background_tasks: [task('MCP task', { server: 'github', tool: 'watch' })] }));
      expect(await readStatusFile()).toMatchObject({ status: 'background', background: ['MCP task'] });
    });

    // An empty list says nothing runs, and a claude too old to send the list says nothing at all, which is no reason to claim anything runs.
    it.each([
      ['an empty list', { background_tasks: [], session_crons: [] }],
      ['no list at all', {}],
    ])('reports idle for %s', async (_case, extra) => {
      runHook('idle', stop(extra));
      const written = await readStatusFile();
      expect(written?.status).toBe('idle');
      expect(written).not.toHaveProperty('background');
    });

    // A `/loop` or a scheduled wakeup will start a turn LATER; nothing is running meanwhile, and counting it would keep a looping session from ever showing finished.
    it('does not count a scheduled wakeup as running', async () => {
      runHook('idle', stop({ background_tasks: [], session_crons: [{ id: 'cron-1', schedule: '*/5 * * * *', recurring: true, prompt: 'check the build' }] }));
      expect((await readStatusFile())?.status).toBe('idle');
    });

    /**
     * Claude watches a published artifact for comments, and lists the watch as a `monitor` while it lasts (measured on claude 2.1.296: one armed by a publish was still listed about 50 minutes later).
     * Nothing runs meanwhile: a comment sent to Claude summons a turn of its own (by claude's source), as a scheduled wakeup starts one.
     */
    const watch = task('monitor', { id: 'sg1al8hmg', description: 'live updates for artifact https://claude.ai/artifact/AbCdEf123 (auto-armed on publish)' });

    it('does not count an artifact watch as running', async () => {
      runHook('idle', stop({ background_tasks: [watch], session_crons: [] }));
      const written = await readStatusFile();
      expect(written?.status).toBe('idle');
      expect(written).not.toHaveProperty('background');
    });

    // A monitor of your own counts as work, and it is listed as `monitor` too, so a watch takes only one of them off the list.
    it('leaves an artifact watch out of what runs beside it', async () => {
      runHook('idle', stop({ background_tasks: [task('shell'), watch, task('monitor')] }));
      expect(await readStatusFile()).toMatchObject({ status: 'background', background: ['shell', 'monitor'] });
    });

    /**
     * A minute at its prompt without input makes claude send an idle notice, `idle_prompt`, whether or not a shell still runs (measured on claude 2.1.289); by its source the same goes for a monitor, while claude itself holds the notice back for a background subagent.
     * While work runs, claude is not waiting for you: that work's end starts a turn of its own, and the same notice a minute after THAT turn is the real one.
     */
    it("keeps background through claude's idle notice, and lets the one after the work has ended say waiting", async () => {
      runHook('idle', stop({ background_tasks: [task('shell')] }));
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
      expect((await readStatusFile())?.status).toBe('background');

      runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>' });
      runHook('idle', stop({ background_tasks: [] }));
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
      expect((await readStatusFile())?.status).toBe('waiting');
    });

    // Only the idle notice is held back: a permission prompt, a question, anything else claude notifies, needs you.
    it.each(['permission_prompt', 'elicitation_dialog', 'agent_needs_input', undefined])('still says waiting over background for a %s notification', async (type) => {
      runHook('idle', stop({ background_tasks: [task('shell')] }));
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification', ...(type ? { notification_type: type } : {}) });
      expect((await readStatusFile())?.status).toBe('waiting');
    });

    it('says waiting over background when claude asks for permission', async () => {
      runHook('idle', stop({ background_tasks: [task('shell')] }));
      runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'WebFetch' });
      expect((await readStatusFile())?.status).toBe('waiting');
    });

    // The turn's own words are a string, so a `"type"` inside them arrives escaped and must not count as a task.
    it('counts nothing out of the words the turn ended on', async () => {
      runHook('idle', stop({ last_assistant_message: 'The payload had "type":"shell" in it.', background_tasks: [task('subagent')] }));
      expect((await readStatusFile())?.background).toEqual(['subagent']);
    });
  });

  /**
   * What the last Stop left running is kept beside the status, for the reader of the transcript that ends what no hook ends (transcriptends.ts).
   * It is that Stop's own payload, so it survives the busy of the next turn, which is when an interrupt needs it.
   */
  describe('what the last Stop left running', () => {
    const stopFile = path.join(statusDir, `${SID}.stop`);
    const shell = { id: 'bh9w6pqmt', type: 'shell', status: 'running', description: 'Background sleep command', command: 'sleep 100' };

    beforeEach(async () => {
      await fs.rm(stopFile, { force: true });
    });

    it('is kept through the turns after it until the next Stop', async () => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell], session_crons: [] });
      runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'permission_prompt' });
      expect(await readReport(SID)).toMatchObject({ status: 'waiting', tab: TOKEN, running: [{ id: 'bh9w6pqmt', type: 'shell' }] });
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [] });
      expect((await readReport(SID))?.running).toEqual([]);
    });

    // A new process has nothing running behind it yet; a compaction leaves what ran running.
    it.each(['startup', 'resume', 'clear'])('is nothing after a SessionStart that says %s', async (source) => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell] });
      runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source });
      expect((await readReport(SID))?.running).toEqual([]);
    });

    it('is kept through a compaction', async () => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell] });
      runHook('busy', { session_id: SID, hook_event_name: 'PreCompact' });
      runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'compact' });
      expect((await readReport(SID))?.running).toEqual([{ id: 'bh9w6pqmt', type: 'shell', description: 'Background sleep command' }]);
    });

    // Without a Stop file nothing is known to run, and nothing the transcript says was started counts as running since.
    it('is nothing, from never, when no Stop has been kept', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
      expect(await readReport(SID)).toMatchObject({ status: 'busy', running: [], runningAt: Infinity });
    });

    it('is no report at all for a session with no status', async () => {
      expect(await readReport(SID)).toBe(null);
    });
  });

  /** An end no hook reports goes through the script, as the hook would have: the script stays the one writer of the status files. */
  describe('reporting an end no hook reports', () => {
    const shell = { id: 'bh9w6pqmt', type: 'shell' };
    const interrupt = (running: Work[] = []): Ending => ({ event: 'transcript:interrupt', status: 'idle', running, ends: ['busy', 'waiting'] });
    const refusal: Ending = { event: 'transcript:refusal', status: 'busy', running: [], ends: ['waiting'] };
    const taskEnd: Ending = { event: 'transcript:task-end', status: 'idle', running: [], ends: ['background'] };
    /** The report the reader would have read: the status file as it is now. */
    const current = async (): Promise<Report> => (await readReport(SID))!;

    beforeEach(async () => {
      await fs.rm(path.join(statusDir, `${SID}.stop`), { force: true });
    });

    it('writes idle when nothing is left running, naming the report', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
      await reportEnd(SID, await current(), interrupt());
      expect(await readStatusFile()).toMatchObject({ status: 'idle', tab: TOKEN, event: 'transcript:interrupt' });
    });

    it('writes background naming what still runs, and keeps it as the last Stop would', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
      await reportEnd(SID, await current(), interrupt([shell]));
      expect(await readStatusFile()).toMatchObject({ status: 'background', background: ['shell'] });
      expect(await readReport(SID)).toMatchObject({ running: [shell] });
    });

    // The list is the Stop's, less what had ended, so it is as old as that Stop: work ending after it still counts as ended.
    it('keeps the time of the Stop its list was taken from', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
      await reportEnd(SID, { ...(await current()), runningAt: 1760000000000 }, interrupt([shell]));
      expect((await readReport(SID))?.runningAt).toBe(1760000000000);
    });

    it('starts a list of its own when no Stop came before it', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
      const before = Date.now();
      await reportEnd(SID, await current(), interrupt());
      expect((await readReport(SID))?.runningAt).toBeGreaterThanOrEqual(before - 1000);
    });

    it('writes busy for a turn that goes on, and keeps what the last Stop left running', async () => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running' }] });
      runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
      await reportEnd(SID, await current(), refusal);
      expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'transcript:refusal' });
      expect((await readReport(SID))?.running).toEqual([shell]);
    });

    // A hook that wrote between the reader's last look and this report has the newer word: a turn's Stop must never be overwritten with busy.
    it.each([
      ['a refusal over the idle of a Stop', refusal, 'idle'],
      ['an interrupt over a background', interrupt(), 'background'],
      ['an end of background work over busy', taskEnd, 'busy'],
    ])('writes nothing for %s', async (_case, ending, status) => {
      runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
      const read = await current();
      if (status === 'idle') runHook('idle', { session_id: SID, hook_event_name: 'Stop' });
      if (status === 'background') runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running' }] });
      if (status === 'busy') runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
      const before = await fs.readFile(statusFile, 'utf8');
      await reportEnd(SID, read, ending);
      expect(await fs.readFile(statusFile, 'utf8')).toBe(before);
    });

    // A new prompt's waiting, written after the reader read the one a refusal answered, is not the waiting the refusal ends.
    it('writes nothing over the same status written in another second', async () => {
      runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
      const read = await current();
      const before = await fs.readFile(statusFile, 'utf8');
      await reportEnd(SID, { ...read, ts: read.ts! - 1 }, refusal);
      expect(await fs.readFile(statusFile, 'utf8')).toBe(before);
    });

    it('writes nothing for a session with no status', async () => {
      runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
      const read = await current();
      await fs.rm(statusFile);
      await reportEnd(SID, read, interrupt());
      expect(await readStatusFile()).toBe(null);
    });
  });

  /**
   * Hooks fired inside a subagent carry the session's own id, told apart by `agent_id` (measured on claude 2.1.289).
   * Once the session's turn has ended, a subagent still at work is a background one, and its tool calls are not the session working again.
   */
  describe('an event from inside a subagent', () => {
    const fromSubagent = { agent_id: 'a4f90cdffb4a6bcc9', agent_type: 'general-purpose' };

    it.each([
      ['idle', {}],
      ['background', { background_tasks: [{ id: 'a4f90cdffb4a6bcc9', type: 'subagent', status: 'running', description: 'a subagent' }] }],
    ])('never writes busy over %s', async (status, extra) => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', ...extra });
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', ...fromSubagent });
      expect((await readStatusFile())?.status).toBe(status);
    });

    // A foreground subagent runs inside the session's turn, so approving its prompt is the session working again, as it is for the session's own.
    it('writes busy over waiting', async () => {
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification' });
      runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse', tool_name: 'Bash', ...fromSubagent });
      expect((await readStatusFile())?.status).toBe('busy');
    });

    // Waiting is the one state that needs you, so it is never held back, whoever asks.
    it('still writes waiting over a finished turn', async () => {
      runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ id: 'a4f90cdffb4a6bcc9', type: 'subagent', status: 'running', description: 'a subagent' }] });
      runHook('waiting', { session_id: SID, hook_event_name: 'Notification', ...fromSubagent });
      expect((await readStatusFile())?.status).toBe('waiting');
    });
  });
});
