/**
 * THE STRENGTH ORDER: which state a session's dot shows when several hold, one list of the statuses and the needs-you categories, the first that holds winning (docs/architecture.md § Status cues).
 * Pure and shared: main checks `settings.json`'s `strength` by it, and the window ranks by it.
 */

import type { NeedsYouRegistry } from './needsyou';

/** The statuses a hook reports, each an entry of the order. */
export const STATUSES = ['waiting', 'busy', 'background', 'idle', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/** The entry standing for every needs-you category the order does not name, in Now's order (their `order`). */
export const NEEDS_YOU = 'needs-you';

/** The category whose two types, claude asking and claude finishing a turn, are the statuses `waiting` and `idle` themselves, never stored reasons, so it has no place of its own in the order. */
export const YOUR_TURN = 'your-turn';

/** The order before anyone has chosen otherwise: claude's own status over a needs-you mark while it waits or works, the mark over a finished turn, as the dot has shown them since the mark came (decided 2026-11-06). */
export const DEFAULT_STRENGTH: readonly string[] = ['waiting', 'busy', 'background', NEEDS_YOU, 'idle', 'closed'];

const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value);

/**
 * Why `value` cannot be the strength order, null when it can: a list of text, each status and `needs-you` once, any other entry a category, none twice, Your turn not one of them.
 * With a registry, a category it does not have is a mistake too; without one, as for a check of a save, any other text passes.
 */
export function strengthProblem(value: unknown, registry: NeedsYouRegistry | null): string | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return 'It has to be a list of names, such as ["waiting", "busy", "background", "needs-you", "idle", "closed"].';
  const entries = value as string[];
  const twice = [...new Set(entries.filter((entry, at) => entries.indexOf(entry) !== at))];
  if (twice.length > 0) return `${quoted(twice)} ${twice.length === 1 ? 'is' : 'are'} named more than once.`;
  const missing = [...STATUSES, NEEDS_YOU].filter((needed) => !entries.includes(needed));
  if (missing.length > 0) return `It has to name ${quoted(missing)} too: every status and "${NEEDS_YOU}" once.`;
  if (entries.includes(YOUR_TURN)) return `"${YOUR_TURN}" has no place of its own: its types are "waiting" and "idle".`;
  if (registry !== null) {
    const known = new Set(registry.categories.map((category) => category.id));
    const unknown = entries.filter((entry) => !isStatus(entry) && entry !== NEEDS_YOU && !known.has(entry));
    if (unknown.length > 0) return `${quoted(unknown)} ${unknown.length === 1 ? 'is' : 'are'} neither a status, "${NEEDS_YOU}" nor a needs-you category.`;
  }
  return null;
}

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');

/**
 * The order as it ranks: `needs-you` gives way to the categories the list does not name, in their order, Your turn left out, and stays after them, where a reason of a category not known yet ranks, such as before main has answered.
 * With the default list and the app's categories: waiting, busy, background, back-to-work, ready-to-merge, look-again, reminders, finish-up, needs-you, idle, closed.
 */
export function expandedStrength(list: readonly string[], registry: NeedsYouRegistry): string[] {
  const named = new Set(list);
  const unnamed = registry.categories.map((category) => category.id).filter((id) => id !== YOUR_TURN && !named.has(id));
  return list.flatMap((entry) => (entry === NEEDS_YOU ? [...unnamed, NEEDS_YOU] : [entry]));
}
