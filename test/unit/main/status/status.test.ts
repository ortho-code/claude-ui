import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('./statushome')).electronStub);
vi.mock('node:os', async () => (await import('./statushome')).osStub);

import { readAllStatuses as getAllStatuses, readReport, reportEnd, type Ending, type Report, type Work } from '../../../../src/main/status/status';
import { statusDir } from '../../../../src/main/paths';
import { readStatusFile, runHook, SID, statusFile, TOKEN, useHookScript } from './hookscript';

useHookScript();

describe('the statuses read at launch', () => {
  // A start is identity, not a state, so it must not come back as one at the next launch: nothing renders it, and the dot's tooltip would show the raw word "start".
  it('leaves out a start', async () => {
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'clear' });
    expect(await getAllStatuses()).not.toHaveProperty(SID);
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    expect(await getAllStatuses()).toHaveProperty(SID, 'busy');
  });

  // 0.3 and earlier wrote `idle` for `ready`, and a file a crash left behind is read at the next launch.
  it('reads a status file written as idle as ready', async () => {
    await fs.mkdir(statusDir, { recursive: true });
    await fs.writeFile(path.join(statusDir, `${SID}.json`), JSON.stringify({ status: 'idle', ts: 1, tab: '', event: 'Stop' }));
    expect(await getAllStatuses()).toHaveProperty(SID, 'ready');
  });

  // Read back at launch as the state it is; what ran comes only with a status event.
  it('reads a turn that ended with work still running as background', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ id: 'task-shell', type: 'shell', status: 'running', description: 'a shell' }] });
    expect(await getAllStatuses()).toHaveProperty(SID, 'background');
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
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell], session_crons: [] });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    runHook('waiting', { session_id: SID, hook_event_name: 'Notification', notification_type: 'permission_prompt' });
    expect(await readReport(SID)).toMatchObject({ status: 'waiting', tab: TOKEN, running: [{ id: 'bh9w6pqmt', type: 'shell' }] });
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [] });
    expect((await readReport(SID))?.running).toEqual([]);
  });

  // A new process has nothing running behind it yet; a compaction leaves what ran running.
  it.each(['startup', 'resume', 'clear'])('is nothing after a SessionStart that says %s', async (source) => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell] });
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source });
    expect((await readReport(SID))?.running).toEqual([]);
  });

  it('is kept through a compaction', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [shell] });
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
  const interrupt = (running: Work[] = []): Ending => ({ event: 'transcript:interrupt', status: 'ready', running, ends: ['busy', 'waiting'] });
  const refusal: Ending = { event: 'transcript:refusal', status: 'busy', running: [], ends: ['waiting'] };
  const taskEnd: Ending = { event: 'transcript:task-end', status: 'ready', running: [], ends: ['background'] };
  /** The report the reader would have read: the status file as it is now. */
  const current = async (): Promise<Report> => (await readReport(SID))!;

  beforeEach(async () => {
    await fs.rm(path.join(statusDir, `${SID}.stop`), { force: true });
  });

  it('writes ready when nothing is left running, naming the report', async () => {
    runHook('busy', { session_id: SID, hook_event_name: 'PostToolUse' });
    await reportEnd(SID, await current(), interrupt());
    expect(await readStatusFile()).toMatchObject({ status: 'ready', tab: TOKEN, event: 'transcript:interrupt' });
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
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running' }] });
    runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await reportEnd(SID, await current(), refusal);
    expect(await readStatusFile()).toMatchObject({ status: 'busy', event: 'transcript:refusal' });
    expect((await readReport(SID))?.running).toEqual([shell]);
  });

  // A hook that wrote between the reader's last look and this report has the newer word: a turn's Stop must never be overwritten with busy.
  it.each([
    ['a refusal over the ready of a Stop', refusal, 'ready'],
    ['an interrupt over a background', interrupt(), 'background'],
    ['an end of background work over busy', taskEnd, 'busy'],
  ])('writes nothing for %s', async (_case, ending, status) => {
    runHook('waiting', { session_id: SID, hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    const read = await current();
    if (status === 'ready') runHook('ready', { session_id: SID, hook_event_name: 'Stop' });
    if (status === 'background') runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [{ ...shell, status: 'running' }] });
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
