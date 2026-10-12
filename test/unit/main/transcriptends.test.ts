import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// A temp HOME so the hook script and the status files land in a throwaway ~/.config.
const { testHome } = vi.hoisted(() => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-transcriptends-')) as string };
});

// paths.ts pins userData to <appData>/claude-ui on import, so the fake app honours setPath (as status.test.ts explains).
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

import { installStatusHooks, type Report } from '../../../src/main/status';
import { statusDir } from '../../../src/main/paths';
import { INTERRUPT_EVENT, TASK_END_EVENT, newFacts, readFact, transcriptChanged, unhookedEnd, type Facts } from '../../../src/main/transcriptends';
import { runHook } from './hookscript';

const shell = { id: 'bh9w6pqmt', type: 'shell' };
const subagent = { id: 'a9f387eb22d2413de', type: 'subagent' };

const report = (status: string, at: number, running = [] as Report['running'], runningAt = 0): Report => ({ status, at, tab: 'tab-token-1', running, runningAt });
const facts = (extra: Partial<Facts>): Facts => ({ ...newFacts(), ...extra });

describe('the end no hook reports', () => {
  describe('an interrupt', () => {
    it('ends a busy turn written before it, as a Stop with nothing running would', () => {
      expect(unhookedEnd(report('busy', 1000), facts({ interruptedAt: 1500 }))).toEqual({ event: INTERRUPT_EVENT, running: [] });
    });

    // Esc at a permission prompt writes the same marker (measured), and the question it answered is gone.
    it('ends a waiting written before it', () => {
      expect(unhookedEnd(report('waiting', 1000), facts({ interruptedAt: 1500 }))).toEqual({ event: INTERRUPT_EVENT, running: [] });
    });

    // A prompt submitted after the interrupt wrote busy after it, and a question claude asked since wrote waiting after it.
    it.each(['busy', 'waiting'])('leaves a %s written after it alone', (status) => {
      expect(unhookedEnd(report(status, 2000), facts({ interruptedAt: 1500 }))).toBe(null);
    });

    it.each(['idle', 'background', 'closed', 'start'])('leaves %s alone, which no interrupt can end', (status) => {
      expect(unhookedEnd(report(status, 1000), facts({ interruptedAt: 1500 }))).toBe(null);
    });

    // Background work survives an interrupt and its own end starts a turn (measured with shells), so until then the session works in the background.
    it('keeps what the last Stop listed running', () => {
      expect(unhookedEnd(report('busy', 1000, [shell, subagent], 500), facts({ interruptedAt: 1500 }))).toEqual({ event: INTERRUPT_EVENT, running: [shell, subagent] });
    });

    it('counts a shell the interrupted turn started', () => {
      const started = [{ ...shell, at: 800 }];
      expect(unhookedEnd(report('busy', 1000, [], 500), facts({ interruptedAt: 1500, started }))).toEqual({ event: INTERRUPT_EVENT, running: [shell] });
    });

    // One started before the last Stop is on its list if it still ran then, and ended if not; and one from an earlier claude died with it.
    it('does not count a shell started before the last Stop', () => {
      const started = [{ ...shell, at: 400 }];
      expect(unhookedEnd(report('busy', 1000, [], 500), facts({ interruptedAt: 1500, started }))).toEqual({ event: INTERRUPT_EVENT, running: [] });
    });

    it('counts a shell the last Stop listed and the turn started once', () => {
      const started = [{ ...shell, at: 800 }];
      expect(unhookedEnd(report('busy', 1000, [shell], 500), facts({ interruptedAt: 1500, started }))).toEqual({ event: INTERRUPT_EVENT, running: [shell] });
    });

    it('does not count work that has ended since the last Stop', () => {
      const started = [{ id: 'b0v2kr5fr', type: 'shell', at: 800 }];
      const ended = new Map([['bh9w6pqmt', 700], ['b0v2kr5fr', 900]]);
      expect(unhookedEnd(report('busy', 1000, [shell], 500), facts({ interruptedAt: 1500, started, ended }))).toEqual({ event: INTERRUPT_EVENT, running: [] });
    });

    // Claude can end an id more than once, as a subagent resumed after it finished: the Stop listing it again is the newer word.
    it('counts work the last Stop listed again after an earlier end', () => {
      expect(unhookedEnd(report('busy', 1000, [subagent], 500), facts({ interruptedAt: 1500, ended: new Map([[subagent.id, 400]]) }))).toEqual({ event: INTERRUPT_EVENT, running: [subagent] });
    });
  });

  describe('work stopped from claude\'s task list', () => {
    it('ends the session\'s background once the last of it has ended', () => {
      expect(unhookedEnd(report('background', 1000, [shell], 1000), facts({ ended: new Map([[shell.id, 1200]]) }))).toEqual({ event: TASK_END_EVENT, running: [] });
    });

    it('takes what ended off the list, and the rest still runs', () => {
      expect(unhookedEnd(report('background', 1000, [shell, subagent], 1000), facts({ ended: new Map([[shell.id, 1200]]) }))).toEqual({ event: TASK_END_EVENT, running: [subagent] });
    });

    it('leaves background alone while all of it runs', () => {
      expect(unhookedEnd(report('background', 1000, [shell], 1000), facts({ ended: new Map([['some-other', 1200]]) }))).toBe(null);
    });

    it('leaves background alone for an end written before the Stop that lists the work', () => {
      expect(unhookedEnd(report('background', 1000, [subagent], 1000), facts({ ended: new Map([[subagent.id, 900]]) }))).toBe(null);
    });

    // A background without a list to check is one this version did not keep: nothing says it has ended.
    it('leaves a background with no list alone', () => {
      expect(unhookedEnd(report('background', 1000, [], Infinity), facts({ ended: new Map([[shell.id, 1200]]) }))).toBe(null);
    });
  });
});

describe('what the transcript has said', () => {
  it('keeps the newest interrupt, the work ended and the work started', () => {
    const f = newFacts();
    readFact(f, { type: 'user', timestamp: '2026-10-12T11:48:02.237Z', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
    readFact(f, { type: 'user', timestamp: '2026-10-12T11:47:00.000Z', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    readFact(f, { type: 'user', timestamp: '2026-10-12T11:50:23.886Z', toolUseResult: { backgroundTaskId: 'bh9w6pqmt' }, message: { content: [{ type: 'tool_result', content: 'Command running in background with ID: bh9w6pqmt.' }] } });
    readFact(f, { type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-12T11:50:31.168Z', content: '<task-notification>\n<task-id>bh9w6pqmt</task-id>\n<status>killed</status>\n</task-notification>' });
    expect(f).toEqual({
      interruptedAt: Date.parse('2026-10-12T11:48:02.237Z'),
      ended: new Map([['bh9w6pqmt', Date.parse('2026-10-12T11:50:31.168Z')]]),
      started: [{ id: 'bh9w6pqmt', type: 'shell', at: Date.parse('2026-10-12T11:50:23.886Z') }],
    });
  });
});

/** The whole path, on real files: the hook script writes the status, a transcript is appended to, and the change is read. */
describe('a transcript that changes', () => {
  // A session of its own for each test: the reader keeps where it read each transcript to, as it does for a session that runs on.
  let n = 0;
  let SID = '';
  let statusFile = '';
  let transcript = '';
  // How long an end waits for a hook to answer it, shortened from the app's second.
  const SETTLE = 50;

  const append = async (record: Record<string, unknown>): Promise<void> => {
    await fs.appendFile(transcript, `${JSON.stringify(record)}\n`);
  };
  /** A record stamped now, after a pause long enough that it cannot share its millisecond with the status written before it. */
  const appendNow = async (record: Record<string, unknown>): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await append({ ...record, timestamp: new Date().toISOString() });
  };
  const marker = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } };
  const readStatusFile = async (): Promise<Record<string, unknown> | null> => {
    try {
      return JSON.parse(await fs.readFile(statusFile, 'utf8'));
    } catch {
      return null;
    }
  };

  beforeEach(async () => {
    await installStatusHooks();
    SID = `2579b6c3-fd2b-4a43-b17a-${String(++n).padStart(12, '0')}`;
    statusFile = path.join(statusDir, `${SID}.json`);
    transcript = path.join(testHome, '.claude', 'projects', '-repo', `${SID}.jsonl`);
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    await append({ type: 'user', timestamp: '2026-10-12T11:47:57.016Z', message: { content: 'run the long one' } });
  });

  it('ends a busy turn that Ctrl+C interrupted', async () => {
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'startup' });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow(marker);
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'idle', event: INTERRUPT_EVENT, tab: 'tab-token-1' });
  });

  it('ends it in the background while a subagent the turn sent off still runs', async () => {
    runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [], session_crons: [] });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow({ type: 'user', toolUseResult: { isAsync: true, status: 'async_launched', agentId: subagent.id, description: 'Run sleep command in background' }, message: { content: [{ type: 'tool_result', content: 'Async agent launched successfully.' }] } });
    runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
    await appendNow(marker);
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'background', event: INTERRUPT_EVENT, background: ['subagent'] });
  });

  it('leaves the busy of a prompt submitted after the interrupt', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow(marker);
    await new Promise((resolve) => setTimeout(resolve, 20));
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'UserPromptSubmit' });
  });

  it('ends background once the work it named is stopped from the task list', async () => {
    runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running', description: 'Background sleep command' }], session_crons: [] });
    expect((await readStatusFile())?.status).toBe('background');
    await appendNow({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>bh9w6pqmt</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<status>killed</status>\n<summary>Task "Background sleep command" was stopped by the user</summary>\n</task-notification>' });
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'idle', event: TASK_END_EVENT });
  });

  // A finished shell's notice is followed by a turn of its own, its busy about 0.1 s later (measured), and that turn says what the session does.
  it('leaves an end that claude answers with a turn of its own to that turn', async () => {
    runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running', description: 'Background sleep command' }], session_crons: [] });
    await appendNow({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>bh9w6pqmt</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<status>completed</status>\n<summary>Background command "Sleep" completed (exit code 0)</summary>\n</task-notification>' });
    const reading = transcriptChanged(transcript, 600);
    await new Promise((resolve) => setTimeout(resolve, 150));
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit', prompt: '<task-notification>' });
    await reading;
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'UserPromptSubmit' });
  });

  // The report after an interrupt is written a second later, and a shell stopped from the task list in that second fires no hook, so only its notice says it has ended.
  it('ends work stopped while the end of an interrupt waits to be reported', async () => {
    runHook('idle', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running', description: 'Background sleep command' }], session_crons: [] });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow(marker);
    const reading = transcriptChanged(transcript, 400);
    await appendNow({ type: 'queue-operation', operation: 'enqueue', content: '<task-notification>\n<task-id>bh9w6pqmt</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<status>killed</status>\n<summary>Task "Background sleep command" was stopped by the user</summary>\n</task-notification>' });
    await reading;
    expect(await readStatusFile()).toMatchObject({ status: 'background', event: INTERRUPT_EVENT });
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'idle', event: TASK_END_EVENT });
  });

  it('reads only what was added since the last read', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow(marker);
    await transcriptChanged(transcript, SETTLE);
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await appendNow({ type: 'user', message: { content: 'and now the next one' } });
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'UserPromptSubmit' });
  });

  it('writes nothing for a session claude-ui does not run', async () => {
    await appendNow(marker);
    await transcriptChanged(transcript, SETTLE);
    expect(await readStatusFile()).toBe(null);
  });
});
