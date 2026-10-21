import { prReference } from '../../../../shared/prs';
import type { PrStatusRead } from '../../../../shared/types';
import { linkedPrs, nextAsk, NO_PR_STATUS } from '../../../prstatus';
import { store } from '../../../state/app';
import { RunGate } from '../../run';

/**
 * Asking main what GitHub says of every PR the sessions link (src/main/prstatus.ts), into the store's `prStatus`.
 * Timed by the gate a panel's runs go through (`RunGate`): an ask whenever the PRs the listing links change, the first listing's included, then each at the delay the answer before it calls for (`nextAsk`).
 * The window regaining focus asks at once, unless the last answer is under a minute old.
 * An ask overtaken by a later one before main answered is dropped, so an older answer never lands over a newer one.
 */

/** How old the last answer may be before the window regaining focus asks again. */
const FOCUS_AFTER_MS = 60_000;

/** When main last answered, in epoch ms; 0 before it has. */
let answeredAt = 0;

/** The PRs to ask about, as one key in an order of its own, so the gate asks again only when the set changes, not when the listing reorders the sessions naming them. */
const linkedKey = (): string => linkedPrs(store.get().sessions).map(prReference).sort().join('\n');

const gate = new RunGate(linkedKey, (number) => void ask(number));

async function ask(number: number): Promise<void> {
  const prs = linkedPrs(store.get().sessions);
  if (prs.length === 0) {
    store.set({ prStatus: NO_PR_STATUS });
    gate.ended(number, 'off');
    return;
  }
  let read: PrStatusRead;
  try {
    read = await window.claudeUi.prStatuses(prs);
  } catch (error) {
    read = { statuses: store.get().prStatus.statuses, problem: error instanceof Error ? error.message : String(error) };
  }
  if (!gate.isLatest(number)) return;
  answeredAt = Date.now();
  store.set({ prStatus: read });
  gate.ended(number, nextAsk(prs, read));
}

/** Start asking: now, for the listing as it is, and again as the listing and the window's focus call for. */
export function watchPrStatus(): void {
  gate.setVisible(true);
  store.watch(['sessions'], () => gate.contextChanged());
  window.addEventListener('focus', () => {
    if (Date.now() - answeredAt >= FOCUS_AFTER_MS) gate.refresh();
  });
}
