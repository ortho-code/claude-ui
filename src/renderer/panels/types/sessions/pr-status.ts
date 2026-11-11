import { approvalsRequired, prKey, prReference, referenceKey } from '../../../../shared/sessions/prs';
import type { PrRef, PrSeen, PrsFound, PrStatusRead, PrToFind } from '../../../../shared/types';
import { entityKey } from '../../../rules/sessions';
import { approvalsIn, createKey, createsToFind, linkedPrs, needsYouNow, nextAsk, NO_PR_STATUS, prChanges, withNames } from '../../../status/pr-status';
import { store, type View } from '../../../state/app';
import { markNeedsYou, marksFor } from '../../../state/needs-you';
import { RunGate } from '../../run';

/**
 * Asking main what GitHub says of every PR the sessions link (src/main/sessions/pr-status.ts), into the store's `prStatus`.
 * Timed by the gate a panel's runs go through (`RunGate`): an ask whenever the PRs the listing links change, the first listing's included, then each at the delay the answer before it calls for (`nextAsk`).
 * The window regaining focus asks at once, unless the last answer is under a minute old.
 * Each answer also marks the sessions whose PRs changed in a way that needs you, against what was last seen of them (`settleChanges`).
 * What each PR is called comes into the store's `prNames` from what was last seen, as soon as that is read, and then from each answer.
 * Each ask first looks for the PRs sessions opened in the browser, every five minutes until each is found or 30 days have passed (`findCreates`).
 * An ask overtaken by a later one before main answered is dropped, so an older answer never lands over a newer one.
 * Only while the setting allows it (`Settings.prStatus`), which is not known before the settings are read: until then, and while it is off, an ask asks nothing and leaves no status, so a launch with it off never runs `gh`; turning it on asks at once.
 */

/** How old the last answer may be before the window regaining focus asks again. */
const FOCUS_AFTER_MS = 60_000;

/** When main last answered, in epoch ms; 0 before it has. */
let answeredAt = 0;

/** Whether the setting lets the window ask; null until the settings are read. */
let allowed: boolean | null = null;

/** How often a PR opened in the browser is looked for while it has not been found. */
const FIND_EVERY_MS = 5 * 60_000;

/** The PRs opened in the browser that were found, by `createKey`, so each is looked for until it is; kept for the life of the window, since a found one is a link from then on. */
const foundCreates = new Set<string>();

/** The PRs opened in the browser still looked for now (`createsToFind`). */
const waitingCreates = (): PrToFind[] => createsToFind(store.get().sessions, foundCreates, Date.now());

/** The PRs to ask about and the ones opened in the browser to look for, as one key in an order of its own, so the gate asks again only when either set changes, not when the listing reorders the sessions naming them. */
const linkedKey = (): string => [...linkedPrs(store.get().sessions).map(prKey), ...waitingCreates().map(createKey)].sort().join('\n');

const gate = new RunGate(linkedKey, (number) => void ask(number));

async function ask(number: number): Promise<void> {
  const stillLooking = allowed === true && (await findCreates(waitingCreates()));
  // A PR found is linked by reading the listing again, which starts an ask of its own.
  if (!gate.isLatest(number)) return;
  const lookAgain = stillLooking ? FIND_EVERY_MS : 'off';
  const prs = allowed === true ? linkedPrs(store.get().sessions) : [];
  if (prs.length === 0) {
    store.set({ prStatus: NO_PR_STATUS });
    gate.ended(number, lookAgain);
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
  store.set({ prStatus: read, prNames: withNames(store.get().prNames, read.statuses) });
  gate.ended(number, sooner(nextAsk(prs, read), lookAgain));
  if (known) settleChanges(prs, read);
}

/** The sooner of two delays, `off` being never. */
function sooner(a: number | 'off', b: number | 'off'): number | 'off' {
  if (a === 'off') return b;
  return b === 'off' ? a : Math.min(a, b);
}

/**
 * Ask main to find the PRs sessions opened in the browser (src/main/sessions/pr-find.ts), which it links to their sessions as the app's own links; the listing is read again once any is found, so the session shows it and its status is asked from then on.
 * Whether any of `creates` is still not found, so the asking goes on; a failed ask finds nothing, and so leaves them all to look for.
 */
async function findCreates(creates: readonly PrToFind[]): Promise<boolean> {
  if (creates.length === 0) return false;
  let result: PrsFound;
  try {
    result = await window.claudeUi.findCreatedPrs([...creates]);
  } catch {
    return true;
  }
  for (const { create } of result.found) foundCreates.add(createKey(create));
  if (result.found.length > 0) {
    const readAt = store.stamp();
    store.set({ sessions: await window.claudeUi.listSessions() }, { readAt });
  }
  return creates.length > result.found.length;
}

/** What was last seen of the PRs, as main keeps it (`prChanges`), once read (`readSeen`); null for never, the first run. */
let seen: PrSeen | null = null;

/** Main's copy read once, the first time anything needs it, so a later write here is never overwritten by a read still on its way; a read that fails is tried again by the next. */
let seenRead: Promise<void> | undefined;

function readSeen(): Promise<void> {
  seenRead ??= window.claudeUi.getPrSeen().then(
    (stored) => {
      seen = stored;
      // An answer that came first named its PRs already, and what it said is newer.
      if (stored !== null) store.set({ prNames: withNames(withNames(new Map(), stored), store.get().prStatus.statuses) });
    },
    (error: unknown) => {
      seenRead = undefined;
      throw error;
    },
  );
  return seenRead;
}

/** The sessions not finished that link the PR whose reference is `pr`, however each spells it (`referenceKey`): whom its change marks, running or not (decided 2026-10-29). */
function linking(pr: string): string[] {
  const { sessions, finished } = store.get();
  const key = referenceKey(pr);
  return sessions.filter((s) => !finished.has(entityKey(s)) && s.prs.some((linked) => prKey(linked) === key)).map(entityKey);
}

/**
 * Mark the sessions whose linked PRs changed in a way that needs you (`prChanges`), each with its PR's change, where its type fires for your role on that PR (`marksFor`), and keep what is seen now.
 * The first run, with nothing seen before, marks only the sessions with a tab or a set-aside mark whose PRs already need you, the ones set aside to wait, rather than every ended session never marked finished (decided 2026-10-29); the open tabs are main's, since the first answer can land before the tabs are restored.
 */
function settleChanges(prs: readonly PrRef[], read: PrStatusRead): void {
  const before = seen;
  const approvals = approvalsIn(store.get().settings);
  const { seen: next, changes } = prChanges(before, prs, read, approvals);
  if (next === null || JSON.stringify(next) === JSON.stringify(before)) return;
  seen = next;
  window.claudeUi.setPrSeen(next);
  const at = Date.now();
  for (const { pr, types } of changes) {
    const role = read.statuses[referenceKey(pr)]?.role ?? null;
    markNeedsYou(
      linking(pr),
      types.filter((type) => marksFor(type, role)).map((type) => ({ type, at, pr })),
    );
  }
  if (before !== null) return;
  void window.claudeUi.getOpenSessions().then((open) => {
    const setAside = new Set([...open, ...store.get().setAside.keys()]);
    for (const pr of prs) {
      const status = read.statuses[prKey(pr)];
      const found = status === undefined ? [] : needsYouNow(status, approvalsRequired(approvals, pr.repository)).filter((type) => marksFor(type, status.role));
      if (found.length > 0) markNeedsYou(linking(prReference(pr)).filter((key) => setAside.has(key)), found.map((type) => ({ type, at, pr: prReference(pr) })));
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
  store.set({ prNames: new Map() });
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
