import { prReference } from '../../../../shared/prs';
import type { PrStatusRead } from '../../../../shared/types';
import { linkedPrs, nextAsk, NO_PR_STATUS } from '../../../prstatus';
import { store, type View } from '../../../state/app';
import { RunGate } from '../../run';

/**
 * Asking main what GitHub says of every PR the sessions link (src/main/prstatus.ts), into the store's `prStatus`.
 * Timed by the gate a panel's runs go through (`RunGate`): an ask whenever the PRs the listing links change, the first listing's included, then each at the delay the answer before it calls for (`nextAsk`).
 * The window regaining focus asks at once, unless the last answer is under a minute old.
 * An ask overtaken by a later one before main answered is dropped, so an older answer never lands over a newer one.
 * Only while the setting allows it (`Settings.prStatus`), which is not known before the settings are read: until then, and while it is off, an ask asks nothing and leaves no status, so a launch with it off never runs `gh`; turning it on asks at once.
 */

/** How old the last answer may be before the window regaining focus asks again. */
const FOCUS_AFTER_MS = 60_000;

/** When main last answered, in epoch ms; 0 before it has. */
let answeredAt = 0;

/** Whether the setting lets the window ask; null until the settings are read. */
let allowed: boolean | null = null;

/** The PRs to ask about, as one key in an order of its own, so the gate asks again only when the set changes, not when the listing reorders the sessions naming them. */
const linkedKey = (): string => linkedPrs(store.get().sessions).map(prReference).sort().join('\n');

const gate = new RunGate(linkedKey, (number) => void ask(number));

async function ask(number: number): Promise<void> {
  const prs = allowed === true ? linkedPrs(store.get().sessions) : [];
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

/** The settings as they now stand (the store's, which a file edit and a save in Settings both set): an ask at once when the setting changes, which asks nothing once it is off and so also stops the timer. */
function followSetting({ settings }: View<'settings'>): void {
  if (settings === null || settings.prStatus.value === allowed) return;
  allowed = settings.prStatus.value;
  gate.refresh();
}

/** Start asking: now, for the listing as it is, and again as the listing, the setting and the window's focus call for. */
export function watchPrStatus(): void {
  gate.setVisible(true);
  store.watch(['sessions'], () => gate.contextChanged());
  store.watch(['settings'], followSetting);
  window.addEventListener('focus', () => {
    if (Date.now() - answeredAt >= FOCUS_AFTER_MS) gate.refresh();
  });
}
