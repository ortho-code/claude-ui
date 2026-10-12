import * as path from 'node:path';
import { errorText, log } from './log';
import { readReport, reportEnd, type Report, type Work } from './status';
import { endedTaskId, isInterruptMarker, readAppended, startedTask, type TranscriptCursor } from './transcript';

/**
 * The ends no hook reports, read from a session's transcript: a turn interrupted by Ctrl+C or Esc, and a shell or a monitor stopped from claude's task list.
 * None of them fired any hook (measured on claude 2.1.289), so the dot stayed busy, waiting or background until claude's next turn.
 * The transcript may END a state the hooks started and never start one: everything else is the hooks' alone.
 */

/** The names the status file gives these reports, as it names the hook event behind any other; not claude's, so none can be mistaken for one. */
export const INTERRUPT_EVENT = 'transcript:interrupt';
export const TASK_END_EVENT = 'transcript:task-end';

/**
 * How long an end the transcript shows, an interrupt's too, waits for a hook to answer it first.
 * A finished shell and a subagent stopped from claude's task list each started a turn of their own, its `UserPromptSubmit` 85 to 136 ms after the notice was written (three measured), and that turn's hooks say what the session is doing.
 * A hook that writes the status in this time has answered the end, whatever it says.
 */
const SETTLE_MS = 1000;

/** What one transcript has said so far that these ends are read from. */
export interface Facts {
  /** When the newest interrupt was written, in ms since the epoch; 0 for none. */
  interruptedAt: number;
  /** When the transcript last said a piece of background work ended, by its id, in ms since the epoch; an id can end more than once, as a subagent resumed after it finished does. */
  ended: Map<string, number>;
  /** The background work it has said was started, with when, in ms since the epoch. */
  started: (Work & { at: number })[];
}

export function newFacts(): Facts {
  return { interruptedAt: 0, ended: new Map(), started: [] };
}

/** Add what one transcript record says to the facts; a record with no time to place it by says nothing. */
export function readFact(facts: Facts, record: Record<string, unknown>): void {
  const at = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
  if (Number.isNaN(at)) return;
  if (isInterruptMarker(record)) {
    facts.interruptedAt = Math.max(facts.interruptedAt, at);
    return;
  }
  const ended = endedTaskId(record);
  if (ended) {
    facts.ended.set(ended, Math.max(facts.ended.get(ended) ?? 0, at));
    return;
  }
  const started = startedTask(record);
  if (started) facts.started.push({ ...started, at });
}

/**
 * What to report in place of the hook that never came, or null when nothing has ended that the last report does not already say.
 *
 * An interrupt written after a busy or a waiting ends the turn as a Stop would, with the work the last Stop listed and any work started since as still running, less whatever has ended since that Stop.
 * A waiting written after the interrupt is taken as a question claude asked since, and stands.
 * Background ends a piece of work at a time: whatever the last Stop listed that has ended since comes off the list, and with nothing left the session is idle.
 * Only an end written after that Stop counts, since one written before it is an earlier end of an id the Stop lists as running again.
 */
export function unhookedEnd(report: Report, facts: Facts): { event: string; running: Work[] } | null {
  const runs = (work: Work): boolean => !((facts.ended.get(work.id) ?? -Infinity) >= report.runningAt);
  if ((report.status === 'busy' || report.status === 'waiting') && facts.interruptedAt > report.at) {
    const listed = new Set(report.running.map((work) => work.id));
    const since = facts.started.filter((work) => work.at >= report.runningAt && !listed.has(work.id)).map(({ id, type }) => ({ id, type }));
    return { event: INTERRUPT_EVENT, running: [...report.running, ...since].filter(runs) };
  }
  if (report.status === 'background' && !report.running.every(runs)) {
    return { event: TASK_END_EVENT, running: report.running.filter(runs) };
  }
  return null;
}

/** Each transcript read so far, by file: where it was read to, what it said, and the read under way. */
interface Read {
  cursor: TranscriptCursor;
  facts: Facts;
  queue: Promise<void>;
  /** A read is already waiting behind the one under way, and it will see this change too. */
  waiting: boolean;
}

const reads = new Map<string, Read>();

/**
 * A transcript changed on disk: read what was added, and report an end it shows that no hook did.
 * A transcript of a session with no status is not one claude-ui runs, and nothing of it is read.
 * Reads of one file run one at a time, with at most one waiting, since each reads everything appended until it starts.
 * Settles once the read that covers this change has; `settleMs` is for the tests.
 */
export function transcriptChanged(file: string, settleMs = SETTLE_MS): Promise<void> {
  let read = reads.get(file);
  if (!read) {
    read = { cursor: { offset: 0, carry: Buffer.alloc(0) }, facts: newFacts(), queue: Promise.resolve(), waiting: false };
    reads.set(file, read);
  }
  if (read.waiting) return read.queue;
  read.waiting = true;
  const at = read;
  at.queue = at.queue
    .then(async () => {
      at.waiting = false;
      await readOn(file, at, settleMs);
    })
    // A read that throws must not end the reads after it, which a rejected queue would.
    .catch((error: unknown) => log('warn', 'status', `cannot read ${file} for its status: ${errorText(error)}`));
  return at.queue;
}

async function readOn(file: string, read: Read, settleMs: number): Promise<void> {
  const id = path.basename(file, '.jsonl');
  if (!(await readReport(id))) {
    // Forgotten only when no read waits behind this one, which would otherwise go on beside a new one from the start of the file.
    if (!read.waiting) reads.delete(file);
    return;
  }
  await readAppended(
    file,
    read.cursor,
    (record) => readFact(read.facts, record),
    () => {
      read.facts = newFacts();
    },
    'status',
  );
  // The report again, now the transcript has been read: a prompt submitted meanwhile has written busy after the interrupt, and that busy stands.
  const report = await readReport(id);
  if (!report) return;
  const end = unhookedEnd(report, read.facts);
  if (!end) return;
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  if ((await readReport(id))?.at !== report.at) return;
  // What is left is the moment between that read and the script's write, in which a hook's write is overwritten: a busy until its next tool call or its Stop, a waiting until the next hook.
  log('info', 'status', `${id}: ${end.event === INTERRUPT_EVENT ? 'interrupted' : 'background work ended'}, from its transcript; ${end.running.length} still running`);
  await reportEnd(id, report.tab, end.event, end.running, report.runningAt);
}
