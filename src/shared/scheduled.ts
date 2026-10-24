import type { ScheduledTask } from './types';

/**
 * The tasks in `list`, each by its prompt, whether it repeats and, for a cron, its schedule in claude's words, and anything without a prompt left out: what claude's `Stop` lists as `session_crons`, once main has found each cron's schedule (src/main/status.ts), and what meta keeps of a stopped tab's (src/main/meta.ts).
 * ONE reading for both, so a task kept for the next launch is the task the clock showed.
 */
export function scheduledTasksOf(list: unknown): ScheduledTask[] {
  if (!Array.isArray(list)) return [];
  return (list as ({ prompt?: unknown; recurring?: unknown; cron?: unknown } | null)[]).flatMap((task) =>
    typeof task?.prompt === 'string' ? [{ prompt: task.prompt, recurring: task.recurring === true, cron: typeof task.cron === 'string' ? task.cron : null }] : [],
  );
}
