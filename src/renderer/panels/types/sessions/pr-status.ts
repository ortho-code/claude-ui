import { prReference } from '../../../../shared/prs';
import type { PrRef, PrSeen, PrStatusRead } from '../../../../shared/types';
import { entityKey } from '../../../logic';
import { linkedPrs, needsYouNow, nextAsk, NO_PR_STATUS, prChanges } from '../../../prstatus';
import { store, type View } from '../../../state/app';
import { markNeedsYou } from '../../../state/needsyou';
import { RunGate } from '../../run';

/**
 * Asking main what GitHub says of every PR the sessions link (src/main/prstatus.ts), into the store's `prStatus`.
 * Timed by the gate a panel's runs go through (`RunGate`): an ask whenever the PRs the listing links change, the first listing's included, then each at the delay the answer before it calls for (`nextAsk`).
 * The window regaining focus asks at once, unless the last answer is under a minute old.
 * Each answer also marks the sessions whose PRs changed in a way that needs you, against what was last seen of them (`settleChanges`).
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
  // Read before main is asked, so what an answer changed is settled without a wait in which another answer could land; a read that failed settles nothing this time.
  const known = await readSeen().then(
    () => true,
    () => false,
  );
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
  if (known) settleChanges(prs, read);
}

/** What was last seen of the PRs, as main keeps it (`prChanges`), once read (`readSeen`); null for never, the first run. */
let seen: PrSeen | null = null;

/** Main's copy read once, the first time anything needs it, so a later write here is never overwritten by a read still on its way; a read that fails is tried again by the next. */
let seenRead: Promise<void> | undefined;

function readSeen(): Promise<void> {
  seenRead ??= window.claudeUi.getPrSeen().then(
    (stored) => {
      seen = stored;
    },
    (error: unknown) => {
      seenRead = undefined;
      throw error;
    },
  );
  return seenRead;
}

/** The sessions not finished that link `pr`: whom its change marks, running or not (decided 2026-10-29). */
function linking(pr: string): string[] {
  const { sessions, finished } = store.get();
  return sessions.filter((s) => !finished.has(entityKey(s)) && s.prs.some((linked) => prReference(linked) === pr)).map(entityKey);
}

/**
 * Mark the sessions whose linked PRs changed in a way that needs you (`prChanges`), each with its PR's change, and keep what is seen now.
 * The first run, with nothing seen before, marks only the sessions with a tab or a set-aside mark whose PRs already need you, the ones set aside to wait, rather than every ended session never marked finished (decided 2026-10-29); the open tabs are main's, since the first answer can land before the tabs are restored.
 */
function settleChanges(prs: readonly PrRef[], read: PrStatusRead): void {
  const before = seen;
  const { seen: next, changes } = prChanges(before, prs, read);
  if (next === null || JSON.stringify(next) === JSON.stringify(before)) return;
  seen = next;
  window.claudeUi.setPrSeen(next);
  const at = Date.now();
  for (const { pr, changes: found } of changes) markNeedsYou(linking(pr), [{ reason: 'pr', at, pr, changes: found }]);
  if (before !== null) return;
  void window.claudeUi.getOpenSessions().then((open) => {
    const setAside = new Set([...open, ...store.get().setAside.keys()]);
    for (const pr of prs) {
      const status = read.statuses[prReference(pr)];
      const found = status === undefined ? [] : needsYouNow(status);
      if (found.length > 0) markNeedsYou(linking(prReference(pr)).filter((key) => setAside.has(key)), [{ reason: 'pr', at, pr: prReference(pr), changes: found }]);
    }
  });
}

/**
 * The settings as they now stand (the store's, which a file edit and a save in Settings both set): an ask at once when the setting changes, which asks nothing once it is off and so also stops the timer.
 * Off, what was seen is emptied, so turning it on again starts from the PRs as they are then and marks only what changes after (decided 2026-10-29); a launch with it off finds it so and writes nothing more once it is empty.
 */
function followSetting({ settings }: View<'settings'>): void {
  if (settings === null || settings.prStatus.value === allowed) return;
  allowed = settings.prStatus.value;
  if (!allowed) void forgetSeen();
  gate.refresh();
}

/** Empty what was seen, here and in main; the read only spares a write when it is empty already, so one that fails empties it all the same, and nothing read after can put the old copy back. */
async function forgetSeen(): Promise<void> {
  const known = await readSeen().then(
    () => true,
    () => false,
  );
  if (known && seen !== null && Object.keys(seen).length === 0) return;
  seen = {};
  seenRead = Promise.resolve();
  window.claudeUi.setPrSeen({});
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
