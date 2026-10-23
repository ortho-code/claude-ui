import type { ScheduledTask } from '../shared/types';
import { scheduledText } from './logic';
import { CLOCK_ICON } from './svg';
import { setTooltip } from './tooltip';

/**
 * The clock beside a session whose last turn left a task scheduled, a `/loop` wakeup or a cron of the session's own: on its tab, its row in the list and its row in the strip, so the task is known before the session is stopped.
 * ONE mark for the three, built and written here, so they cannot come to say different things; each surface places it and gives it its look, `className`, as each does its worktree mark.
 * A row's marks are pills, so there the icon sits in the pill's icon box (`pill`), as the row's worktree mark's does.
 */
export function scheduledMark(className: string, pill = false): HTMLElement {
  const mark = document.createElement('span');
  mark.className = `scheduled-mark ${className}`;
  mark.innerHTML = pill ? `<span class="badge-icon">${CLOCK_ICON}</span>` : CLOCK_ICON;
  mark.hidden = true;
  return mark;
}

/** Show the clock for these tasks, naming each in its tooltip, or hide it for none; says whether it shows. */
export function showScheduled(mark: HTMLElement, tasks: readonly ScheduledTask[] | undefined): boolean {
  const text = scheduledText(tasks ?? []);
  mark.hidden = text === null;
  setTooltip(mark, text);
  // Wordless, so it carries its words for a screen reader too.
  if (text) mark.setAttribute('aria-label', text);
  else mark.removeAttribute('aria-label');
  return text !== null;
}
