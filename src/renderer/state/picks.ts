import type { SessionSummary } from '../../shared/types';
import { store, withEntry, type View } from './app';

/**
 * WHERE THE PANELS LOOK FOR A SESSION, when it is not where the session works: a checkout picked from its worktree list (`AppState.picks`).
 * Read here, the one rule for the panels and for the list's tick, so the two cannot disagree.
 */

/** The checkout picked for a session's panels, while its list still holds it and it is not gone; '' while the panels follow the session. */
export function pickedFor(session: SessionSummary, view: View<'picks'> = store.get()): string {
  const picked = view.picks.get(session.id) ?? '';
  return session.checkouts.some(({ root, gone }) => root === picked && !gone) ? picked : '';
}

/** Pick a checkout of a session's list for its panels, by its root, or '' to follow the session again. */
export function pickCheckout(id: string, root: string): void {
  store.set({ picks: withEntry(store.get().picks, id, root || undefined) });
}
