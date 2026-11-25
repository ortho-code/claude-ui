import { SORTS } from '../../shared/query/sorts';
import type { SessionSummary } from '../../shared/types';

/**
 * RECENT, pure (docs/architecture/session-list.md § Recent): the session list flat, last worked on first (`SORTS.activity`).
 * Pins are not floated here, unlike in the grouped list (decided 2026-11-04): a pin says where a session belongs among its project's sections, and Recent has none, so floating them would break the one order Recent is for; the tab bar does not float them either (`orderAsTabs`, rules/claude.ts).
 */
export function recentOrder(sessions: readonly SessionSummary[]): SessionSummary[] {
  return [...sessions].sort(SORTS.activity);
}
