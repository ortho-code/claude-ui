import type { ClosedHow } from '../../../../shared/types';
import { sessionsByKey, unstartableReason } from '../../../rules/sessions';
import { store } from '../../../state/app';
import { markNeedsYou, marks } from '../../../state/needsyou';
import { clearNudge } from '../../../state/statuses';
import { whileRestoring } from './opentabs';
import { remembered, tabOf } from './tabstate';
import { activateTab, buildTab, startTab } from './terminals';

export async function restoreOpenTabs(): Promise<void> {
  /** The tabs to start once restored: those whose sessions were running when the app closed, when Settings says to start them. */
  const resume: string[] = [];
  /** The sessions to mark as needing you: those that were running when the app closed, unless Settings says to leave them with the others. */
  const marked: string[] = [];
  let closedHow: ClosedHow = 'unknown';
  await whileRestoring(async () => {
    // The running list is read here, before the write below replaces it with what runs now, which is nothing yet.
    const [sessions, openKeys, activeKey, byProject, runningKeys, scheduledByKey, settings, lastClosed] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
      window.claudeUi.getActiveSession(),
      window.claudeUi.getActiveSessionByProject(),
      window.claudeUi.getRunningSessions(),
      window.claudeUi.getScheduledWhenStopped(),
      window.claudeUi.getSettings(),
      window.claudeUi.getLastClosed(),
    ]);
    closedHow = lastClosed;
    remembered.byProject = { ...byProject };
    remembered.last = activeKey;
    const tips = sessionsByKey(sessions);
    const atLaunch = settings.runningSessionsAtLaunch.value;
    // Restore the tabs COLD — no claude process each.
    // Starting them all was costing 20 processes at ~437 MB on this machine, spawned whether or not any was used, plus 20 CLI cold starts on every launch.
    // A tab starts when you select it, or below if it was running when the app closed and Settings says to start it: only what was in use costs a process.
    // One change for every tab and the one selected, so whoever draws the tabs draws them once rather than once per tab.
    store.batch(() => {
      let toActivate: string | null = null;
      for (const key of openKeys) {
        const session = tips.get(key);
        // Not a finished one, which is put away rather than resumed (`unopenableReason`): the list has read the finished ones by now, and the tab is dropped from what is kept.
        if (!session || store.get().finished.has(key)) continue;
        const wasRunning = runningKeys.includes(key);
        // What it said was scheduled when its claude went, which it goes on saying until a claude started on it reports.
        const token = buildTab(session, scheduledByKey[key] ?? null);
        if (key === activeKey) toActivate = token;
        // One that was running comes back marked as needing you, unless `needsYou` in settings.json switches that type off (`app.was-running`): what was in hand needs you at launch, and stays marked until your next prompt there, started or not.
        if (wasRunning && marks('app.was-running')) marked.push(key);
        if (wasRunning && atLaunch === 'start') resume.push(token);
      }
      // Its claude has gone, so what its status file last said is forgotten, as a tab going cold forgets it (`coolTab`): after an end without a quit the file still holds it, and a busy or a waiting from then would hide the mark.
      for (const key of marked) clearNudge(key);
      markNeedsYou(marked, [{ type: 'app.was-running', at: Date.now(), how: closedHow }]);
      // Land where you left off — SELECTED but not started here; it starts below with the others if it was running and Settings says to start them.
      // Without a remembered tab we open on none rather than guessing.
      if (toActivate) activateTab(toActivate, false);
    });
  });
  // Each in its own tab, the one on show and those out of sight alike.
  // A tab whose folder has gone stays cold, saying why once selected, rather than putting up a toast per tab at launch.
  for (const token of resume) {
    const tab = tabOf(token);
    if (tab && !unstartableReason(tab.session)) void startTab(token);
  }
}
