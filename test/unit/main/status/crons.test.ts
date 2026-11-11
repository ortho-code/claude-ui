import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('./statushome')).electronStub);
vi.mock('node:os', async () => (await import('./statushome')).osStub);

import { readScheduled } from '../../../../src/main/status/crons';
import { readReport, reportEnd } from '../../../../src/main/status/status';
import { statusDir } from '../../../../src/main/paths';
import { readStatusFile, runHook, SID, useHookScript } from './hookscript';

useHookScript();

/** What the last Stop left scheduled, read from the same file, for the clock beside the session (`session:scheduled`). */
describe('what the last Stop left scheduled', () => {
  const stopFile = path.join(statusDir, `${SID}.stop`);
  const wakeup = { id: 'b7a70443', schedule: '53 23 * * *', recurring: false, prompt: '/loop say the word tick' };
  const cron = { id: '1eb67062', schedule: '7,17,27,37,47,57 * * * *', recurring: true, prompt: 'say the word tock' };
  /** A transcript line as claude writes a `CronCreate` call's result (seen 2026-10-24), and one as it writes a `ScheduleWakeup` call's, which carries no id. */
  const cronMade = (id: string, schedule: string): string => JSON.stringify({ type: 'user', message: { role: 'user', content: [] }, toolUseResult: { id, humanSchedule: schedule, recurring: true, durable: false, nextFireAt: 1792782757451 } });
  const wakeupMade = JSON.stringify({ type: 'user', message: { role: 'user', content: [] }, toolUseResult: { scheduledFor: 1792797360000, clampedDelaySeconds: 1200, wasClamped: false } });
  /** A transcript of its own per check, since main keeps how far it has read each one. */
  let transcript = '';
  let made = 0;

  beforeEach(async () => {
    await fs.rm(stopFile, { force: true });
    transcript = path.join(statusDir, `transcript-${++made}.jsonl`);
    await fs.writeFile(transcript, `${wakeupMade}\n${cronMade(cron.id, 'Every 10 minutes')}\n`);
  });

  it("is each task the Stop listed, by its prompt, whether it repeats and, for a cron, its schedule as its transcript gives it", async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, background_tasks: [], session_crons: [wakeup, cron] });
    expect(await readScheduled(SID)).toEqual([
      { prompt: '/loop say the word tick', recurring: false, cron: null },
      { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' },
    ]);
  });

  it('reads a transcript on from where it last stopped, and anew one that shrank', async () => {
    const later = { ...cron, id: '34f607db', prompt: 'say hi' };
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, session_crons: [cron] });
    expect((await readScheduled(SID))?.[0]?.cron).toBe('Every 10 minutes');
    await fs.appendFile(transcript, `${cronMade(later.id, 'Every 5 minutes')}\n`);
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, session_crons: [cron, later] });
    expect((await readScheduled(SID))?.map((task) => task.cron)).toEqual(['Every 10 minutes', 'Every 5 minutes']);
    await fs.writeFile(transcript, `${cronMade(later.id, 'Every hour')}\n`);
    expect((await readScheduled(SID))?.map((task) => task.cron)).toEqual([null, 'Every hour']);
  });

  it('takes two looks at one transcript in turn, so a look after them skips nothing written since', async () => {
    const later = { ...cron, id: '34f607db', prompt: 'say hi' };
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, session_crons: [cron] });
    await Promise.all([readScheduled(SID), readScheduled(SID)]);
    // More is written after the new cron than the transcript held before, so a look that went on from twice that length would start past it.
    const before = (await fs.stat(transcript)).size;
    await fs.appendFile(transcript, `${cronMade(later.id, 'Every 5 minutes')}\n${'x'.repeat(before * 2)}\n`);
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, session_crons: [cron, later] });
    expect((await readScheduled(SID))?.map((task) => task.cron)).toEqual(['Every 10 minutes', 'Every 5 minutes']);
  });

  it('takes a task as no cron when the Stop names no transcript, or one that is not there', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', session_crons: [cron] });
    expect(await readScheduled(SID)).toEqual([{ prompt: 'say the word tock', recurring: true, cron: null }]);
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: path.join(statusDir, 'gone.jsonl'), session_crons: [cron] });
    expect(await readScheduled(SID)).toEqual([{ prompt: 'say the word tock', recurring: true, cron: null }]);
  });

  it('leaves out an entry without a prompt, and reads a missing repeat as once', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', session_crons: [null, { id: 'x' }, { prompt: 'check the build' }] });
    expect(await readScheduled(SID)).toEqual([{ prompt: 'check the build', recurring: false, cron: null }]);
  });

  it('is nothing from a Stop with an empty list, or with no Stop file, whose claude has gone', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [], session_crons: [] });
    expect(await readScheduled(SID)).toEqual([]);
    await fs.rm(stopFile);
    expect(await readScheduled(SID)).toEqual([]);
  });

  // A start writes `{}`: a claude started again has reported nothing yet, which is not news that nothing is scheduled.
  it('is unknown, not nothing, after a start or from a Stop without the list', async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', session_crons: [cron] });
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'resume' });
    expect(await readScheduled(SID)).toBe(null);
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', background_tasks: [] });
    expect(await readScheduled(SID)).toBe(null);
  });

  // An interrupt before the first Stop of a claude started again: the end the app reports has no list to carry, and makes none up.
  it("stays unknown through an end reported in a hook's place before any Stop", async () => {
    runHook('start', { session_id: SID, hook_event_name: 'SessionStart', source: 'resume' });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await reportEnd(SID, (await readReport(SID))!, { event: 'transcript:interrupt', status: 'ready', running: [], ends: ['busy', 'waiting'] });
    expect(await readStatusFile()).toMatchObject({ status: 'ready', event: 'transcript:interrupt' });
    expect(await readScheduled(SID)).toBe(null);
  });

  // Read while the script is still writing it, the file is cut short: nothing is said then, rather than that nothing is scheduled.
  it('is unknown, not nothing, from a file that does not parse', async () => {
    await fs.writeFile(stopFile, '{"session_crons":[{"prompt":"say');
    expect(await readScheduled(SID)).toBe(null);
  });

  it("is kept through an end reported in a hook's place, a cron still told by its transcript", async () => {
    runHook('ready', { session_id: SID, hook_event_name: 'Stop', transcript_path: transcript, background_tasks: [], session_crons: [cron] });
    runHook('busy', { session_id: SID, hook_event_name: 'UserPromptSubmit' });
    await reportEnd(SID, (await readReport(SID))!, { event: 'transcript:interrupt', status: 'ready', running: [], ends: ['busy', 'waiting'] });
    expect(await readStatusFile()).toMatchObject({ status: 'ready', event: 'transcript:interrupt' });
    expect(await readScheduled(SID)).toEqual([{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }]);
  });
});
