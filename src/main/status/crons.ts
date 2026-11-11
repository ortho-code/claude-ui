import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { statusDir } from '../paths';
import { scheduledTasksOf } from '../../shared/status/scheduled';
import type { ScheduledTask } from '../../shared/types';

/**
 * The tasks a session's last Stop left scheduled, from its `session_crons`, each entry without a prompt left out; none for a session with no Stop file, whose claude has gone.
 * Null, so the caller sends nothing, for what says nothing of them: a file that does not parse, such as one read while the script is still writing it (it truncates first), and one with no `session_crons` at all, which is what a start other than a compaction's writes (`{}`).
 * A claude started again has reported nothing yet, and its start's file is not news that nothing is scheduled: what it brings back shows from its first Stop, until when its tab goes on showing what it had when it stopped.
 */
export async function readScheduled(id: string): Promise<ScheduledTask[] | null> {
  let text: string;
  try {
    text = await fs.readFile(path.join(statusDir, `${id}.stop`), 'utf8');
  } catch {
    return [];
  }
  let stop: { session_crons?: unknown; transcript_path?: unknown };
  try {
    stop = JSON.parse(text) as { session_crons?: unknown; transcript_path?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(stop.session_crons)) return null;
  const listed = stop.session_crons as ({ id?: unknown } | null)[];
  // Which of them are crons, and on what schedule, only the transcript says (`cronSchedules`).
  const schedules = listed.length > 0 && typeof stop.transcript_path === 'string' ? await cronSchedules(stop.transcript_path) : new Map<string, string>();
  return scheduledTasksOf(listed.map((task) => (typeof task?.id === 'string' && schedules.has(task.id) ? { ...task, cron: schedules.get(task.id) } : task)));
}

/** How far each transcript has been read for its crons, the line cut off at the end of that read, and the schedules found. */
const cronsRead = new Map<string, { offset: number; decoder: StringDecoder; rest: string; schedules: Map<string, string> }>();
/** The last look at each transcript, which the next one waits for. */
const cronsLooked = new Map<string, Promise<unknown>>();

/**
 * Each cron a session's claude made, by its id, with its schedule in claude's words: the result of each `CronCreate` call in the transcript, `{"id": "34f607db", "humanSchedule": "Every 10 minutes", …}`, whose id is the one its `Stop` list names.
 * Seen in session f3829708 on 2026-10-24, for a cron's id, and against a `/loop` wakeup's, whose `ScheduleWakeup` result carries no id at all.
 * A subagent's calls are kept in a transcript of their own (seen in session 2e8cf79b, whose own transcript holds none of them), so a cron a subagent made would not be found here; not tried.
 * One look at a time per transcript: two at once would each go on from the same place, and the look after them would start past what was written since.
 */
function cronSchedules(transcript: string): Promise<ReadonlyMap<string, string>> {
  const look = (cronsLooked.get(transcript) ?? Promise.resolve()).then(() => lookForCrons(transcript));
  cronsLooked.set(transcript, look.catch(() => undefined));
  return look;
}

/** One look for crons, read on from where the last stopped, since a transcript only grows and can run to tens of megabytes; one that shrank is read again from its start. */
async function lookForCrons(transcript: string): Promise<ReadonlyMap<string, string>> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(transcript, 'r');
  } catch {
    return cronsRead.get(transcript)?.schedules ?? new Map();
  }
  try {
    const { size } = await handle.stat();
    let seen = cronsRead.get(transcript);
    if (!seen || size < seen.offset) {
      seen = { offset: 0, decoder: new StringDecoder('utf8'), rest: '', schedules: new Map() };
      cronsRead.set(transcript, seen);
    }
    const chunk = Buffer.alloc(1 << 20);
    while (seen.offset < size) {
      const { bytesRead } = await handle.read(chunk, 0, Math.min(chunk.length, size - seen.offset), seen.offset);
      if (bytesRead === 0) break;
      seen.offset += bytesRead;
      const lines = (seen.rest + seen.decoder.write(chunk.subarray(0, bytesRead))).split('\n');
      seen.rest = lines.pop() ?? '';
      for (const line of lines) {
        // Most lines are not a cron's result; only the ones that could be are parsed.
        if (!line.includes('"humanSchedule"')) continue;
        try {
          const result = (JSON.parse(line) as { toolUseResult?: { id?: unknown; humanSchedule?: unknown } }).toolUseResult;
          if (typeof result?.id === 'string' && typeof result.humanSchedule === 'string') seen.schedules.set(result.id, result.humanSchedule);
        } catch {
          // A line that does not parse names no cron.
        }
      }
    }
    return seen.schedules;
  } finally {
    await handle.close();
  }
}
