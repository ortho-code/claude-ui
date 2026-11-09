import type { SessionSummary } from '../../shared/types';

/**
 * RECENT, pure (docs/architecture/session-list.md § Recent): the session list flat, last worked on first.
 * By the time each last worked, read as a time rather than compared as text, since the ISO form is how Claude Code writes it today rather than a contract; a session whose time cannot be read sorts last.
 * Pins are not floated here, unlike in the grouped list (decided 2026-11-04): a pin says where a session belongs among its project's sections, and Recent has none, so floating them would break the one order Recent is for; the tab bar does not float them either (`orderAsTabs`, logic.ts).
 */
export function recentOrder(sessions: readonly SessionSummary[]): SessionSummary[] {
  const at = (session: SessionSummary): number => Date.parse(session.lastActivity) || 0;
  return [...sessions].sort((a, b) => at(b) - at(a));
}
