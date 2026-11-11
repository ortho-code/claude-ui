import type { ScheduledTask } from '../types';

/**
 * The tasks in `list`, each by its prompt, whether it repeats and, for a cron, its schedule in claude's words, and anything without a prompt left out: what claude's `Stop` lists as `session_crons`, once main has found each cron's schedule (src/main/status/crons.ts), and what meta keeps of a stopped tab's (src/main/sessions/meta.ts).
 * ONE reading for both, so a task kept for the next launch is the task the clock showed.
 */
export function scheduledTasksOf(list: unknown): ScheduledTask[] {
  if (!Array.isArray(list)) return [];
  return (list as ({ prompt?: unknown; recurring?: unknown; cron?: unknown } | null)[]).flatMap((task) =>
    typeof task?.prompt === 'string' ? [{ prompt: task.prompt, recurring: task.recurring === true, cron: typeof task.cron === 'string' ? task.cron : null }] : [],
  );
}

/**
 * Whether a submitted prompt is a turn claude started itself rather than one you typed, which fire `UserPromptSubmit` alike (measured on claude 2.1.310).
 * Where claude says where the prompt came from (`source`, which its hook schema names, `user` for its prompt box, and 2.1.310 did not yet send), that decides.
 * Without it, by the prompt: a background task's end is a `<task-notification>`, and a scheduled task firing is the prompt listed for it (`scheduled`), the same text in the run measured.
 * A prompt you type that is exactly a scheduled task's then reads as claude's, and one over the 1000 characters claude lists of it is not matched and reads as yours.
 */
export function startedByClaude(prompt: string, scheduled: readonly string[], source?: string): boolean {
  if (source !== undefined) return source !== 'user';
  return prompt.startsWith('<task-notification>') || scheduled.includes(prompt);
}
