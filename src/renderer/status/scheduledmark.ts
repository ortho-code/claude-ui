import { iconMark, showIconMark } from '../ui/iconmark';
import { clockText, type ClockShown } from '../rules/logic';
import { CLOCK_ICON } from '../ui/svg';

/**
 * The clock beside a session whose last turn left a task scheduled, a `/loop` wakeup or a cron of the session's own: on its tab and its row in the list, so the task is known before the session is stopped.
 * Muted for what a tab kept from when its claude went (`clockOf`), as a worktree mark can be muted.
 * The session's menu says the same, in the same words (`clockLines`), as Scheduled.
 * ONE mark for the three (`iconMark`), so they cannot come to say different things; each surface places it and gives it its look, `className`, as each does its worktree mark.
 */
export function scheduledMark(className: string, pill = false): HTMLElement {
  return iconMark(`scheduled-mark ${className}`, CLOCK_ICON, pill);
}

/** Show the clock as `clockOf` says, naming each task in its tooltip, muted for a stopped tab's, or hide it for nothing; says whether it shows. */
export function showScheduled(mark: HTMLElement, clock: ClockShown | null): boolean {
  mark.classList.toggle('stopped', clock?.stopped === true);
  return showIconMark(mark, clockText(clock));
}
