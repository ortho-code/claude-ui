import type { ScheduledTask } from '../../shared/types';

/**
 * What becomes of a task when its session's claude goes, said beside it wherever it is named, so it is known before a stop rather than asked at it.
 * Measured on claude 2.1.302: a cron, one-shot or repeating, came back with the same id when the session was resumed, whether claude's own question was answered "Exit and stop tasks" or the session was forced out; a `/loop` wakeup did not.
 */
function afterStop(task: ScheduledTask): string {
  return task.cron === null ? 'ends with the session' : 'comes back when you open the session';
}

/**
 * What a session's clock says of the tasks claude has scheduled for it, under its heading, one line each: its prompt, a cron's schedule in claude's words, and what a stop does to it (`afterStop`); null for none, which shows no clock.
 * Claude cuts a long prompt short in what it reports, so the line ends where it did.
 */
export function scheduledLines(tasks: readonly ScheduledTask[], heading = 'Scheduled:'): string[] | null {
  if (tasks.length === 0) return null;
  return [heading, ...tasks.map((task) => [task.prompt, task.cron, afterStop(task)].filter((part) => part !== null).join(' · '))];
}

/** What a session's clock shows: its tasks, and whether they are the ones its tab kept from when its claude went (`stopped`), which the clock shows muted. */
export interface ClockShown {
  tasks: readonly ScheduledTask[];
  stopped: boolean;
}

/**
 * What a session's clock shows, ONE rule for its tab and its row: what its claude last reported scheduled (`live`), or else, muted, what its tab kept from when its claude went (`TabState.scheduledWhenStopped`); null for neither.
 * A tab keeps those through a start of its claude until that claude reports, since a start says nothing of what it brought back, and a `/loop` wakeup among them may not come back.
 */
export function clockOf(live: readonly ScheduledTask[] | undefined, tab: { scheduledWhenStopped: readonly ScheduledTask[] | null } | undefined): ClockShown | null {
  if (live && live.length > 0) return { tasks: live, stopped: false };
  if (tab?.scheduledWhenStopped) return { tasks: tab.scheduledWhenStopped, stopped: true };
  return null;
}

/** What a clock says, line by line: its tasks under the heading for live ones or for the ones a stopped tab kept (`scheduledLines`); null for no clock. */
export function clockLines(clock: ClockShown | null): string[] | null {
  return clock ? scheduledLines(clock.tasks, clock.stopped ? 'Scheduled when stopped:' : 'Scheduled:') : null;
}

/** What a clock says, wherever it is said as one text, such as its tooltip (`clockLines`); null for no clock. */
export function clockText(clock: ClockShown | null): string | null {
  return clockLines(clock)?.join('\n') ?? null;
}
