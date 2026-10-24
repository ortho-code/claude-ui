import type { ScheduledTask } from './types';

/**
 * The tasks in `list`, each by its prompt and whether it repeats, and anything without a prompt left out: what claude's `Stop` lists as `session_crons` (src/main/status.ts).
 */
export function scheduledTasksOf(list: unknown): ScheduledTask[] {
  if (!Array.isArray(list)) return [];
  return (list as ({ prompt?: unknown; recurring?: unknown } | null)[]).flatMap((task) =>
    typeof task?.prompt === 'string' ? [{ prompt: task.prompt, recurring: task.recurring === true }] : [],
  );
}
