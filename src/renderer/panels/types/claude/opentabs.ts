import { entityKey } from '../../../rules/sessions';
import { store, type TabState } from '../../../state/app';
import { isQuitting, whenQuitting } from '../../../window/quitting';
import { keptWhenGone, setTab } from './tabstate';

let restoring = false;

/**
 * The open tabs and which of them run, for the next launch.
 * Written when a tab opens, closes or moves, when its process starts, and when its process goes: a stop leaves the tab cold, an exit of its own removes it, and one within its first moments, a failed start, leaves it cold too.
 * A session still being stopped has its process until claude has gone, so it is written as running until then.
 */
export function persistOpenTabs(): void {
  // Once the app is quitting, every terminal is ended and each pty's exit closes its tab: those closes must not persist an empty open-tabs list over the real one, which would wipe the tabs to restore next launch.
  if (restoring || isQuitting()) return;
  const { tabs } = store.get();
  const keyOf = tabKeys();
  window.claudeUi.setOpenSessions(
    tabs.map(keyOf),
    tabs.filter((tab) => tab.terminalId !== null).map(keyOf),
  );
  writeScheduledWhenStopped();
}

/** Restore the tabs with `restore`, writing none of them until it is done, and then all of them at once. */
export async function whileRestoring<T>(restore: () => Promise<T>): Promise<T> {
  restoring = true;
  try {
    return await restore();
  } finally {
    restoring = false;
    persistOpenTabs();
  }
}

/**
 * Each tab's key for the next launch: its session's entity key, immutable, so a restart always finds it again.
 * A session with no transcript yet is not in the map; its own id stands in, and restore drops it, which is right — there is nothing on disk to reopen.
 */
function tabKeys(): (tab: TabState) => string {
  const idToKey = new Map(store.get().sessions.map((s) => [s.id, entityKey(s)]));
  return (tab) => idToKey.get(tab.session.id) ?? tab.session.id;
}

/** What the tabs keep of their sessions' tasks, beside the open tabs, in a write of its own, which main keeps for the open tabs only. */
function writeScheduledWhenStopped(): void {
  const keyOf = tabKeys();
  window.claudeUi.setScheduledWhenStopped(Object.fromEntries(store.get().tabs.flatMap((tab) => (tab.scheduledWhenStopped ? [[keyOf(tab), [...tab.scheduledWhenStopped]]] : []))));
}

// A quit forces every claude out, and the exits it causes write nothing (`persistOpenTabs`), so each tab still running keeps what its stop would have kept, written as the window hears of the quit, which main tells it before it ends any.
whenQuitting(() => {
  for (const tab of store.get().tabs) if (tab.terminalId !== null) setTab(tab.token, { scheduledWhenStopped: keptWhenGone(tab) });
  writeScheduledWhenStopped();
});
