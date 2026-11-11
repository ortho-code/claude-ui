// First, and for its side effect: paths.ts pins the userData directory, and must run before any module computes a path from it.
// See the comment there.
import './paths';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { existsSync } from 'node:fs';
import { findTranscript, listSessions, trashSessions, worktreeExists } from './sessions/sessions';
import { readHistory } from './sessions/transcript';
import { liveTerminals, registerTerminalIpc, shellFolders, terminateAll } from './pty/terminal';
import { KILL_GRACE_MS, untilGone } from './pty/shell';
import { registerConfig } from './config/config';
import { registerFolders } from './window/folders';
import { liveRuns, registerPanelsIpc, stopAllPanels } from './panels/panels';
import { forgetSessions, keepShellFolders, registerPanelData } from './panels/panel-data';
import { logsDir } from './paths';
import { startLog, closeLog, lastClosed } from './logs/log';
import { recordUsage, reviewUsageOf, trimUsage } from './logs/usage';
import { headerLines, logGpuStatus, logProcessFailures, registerRendererLog } from './logs/diagnostics';
import { localTimestamp } from './files/stamp';
import { getOpenSessions, getPrLinks, purgeSession, registerMetaIpc } from './sessions/meta';
import { migrateToSessionKeys } from './sessions/meta-store';
import { registerGroupsIpc } from './sessions/groups';
import { registerMarksIpc } from './status/marks';
import { readBundledNeedsYou } from './status/needs-you';
import { registerSettings } from './config/settings';
import { registerLayoutState } from './panels/layout-state';
import { registerClipboardIpc } from './platform/clipboard';
import { registerPrFind } from './sessions/pr-find';
import { registerPrStatus } from './sessions/pr-status';
import { withPrLinks } from '../shared/sessions/prs';
import { registerStatusIpc, clearStatuses } from './status/status';
import { installStatusHooks } from './status/hooks';
import { registerSessionsWatcher } from './sessions/watcher';
import { transcriptChanged } from './status/transcript-ends';
import { NO_TRANSCRIPT } from '../shared/sessions/history';
import type { HistorySlice } from '../shared/types';
import { createWindow, currentWindow, registerWindowIpc } from './window/main-window';
import { learnMaximizeInset, registerGeometry } from './window/geometry';

// `--no-sandbox` cannot be set from inside the app.
// Do NOT try `app.commandLine.appendSwitch('no-sandbox')`: it was tried and reverted, because it runs too late for the renderer, which then dies with a FATAL about /dev/shm permissions (misleading — /dev/shm is fine) and leaves an empty window painted in the background colour.
// Measured both ways with a throwaway XDG_CONFIG_HOME: argv flag clean, appendSwitch fatal.
// The switch has to be on the command line before Electron starts, so it belongs to whatever launches the app — the `start` script in development, and the packaged launcher's own arguments once there is one.

// The app stays on X11 (Xwayland) under WSLg.
// Do NOT add --ozone-platform=wayland: it paints this window solid white, with or without app.disableHardwareAcceleration().
// Both were tried and reverted.
// See docs/architecture/platforms.md, including the note on an all-arrow cursor, which looks like an X11 limitation but is WSLg's pointer state stuck.

// Only one claude-ui instance at a time; a second launch focuses the existing window.
// This may change if we add pop-out / multi-window sessions later.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const launched = localTimestamp();
  startLog({ dir: logsDir, header: () => headerLines(launched) });
  logProcessFailures();
  registerRendererLog();
  void trimUsage();
  logGpuStatus();
  app.on('second-instance', () => {
    const mainWindow = currentWindow();
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

/**
 * The application menu, which is a platform decision rather than a preference.
 *
 * On Linux there is none, so the default File/Edit/View items — reload, dev tools, view source — stay out of a UI that drives everything itself.
 *
 * macOS cannot afford that.
 * There, Cmd+C/V/X/A/Z are delivered by menu ROLES, not by the focused web contents, so a null menu silently costs copy and paste everywhere, the terminal included.
 * This is the smallest menu that keeps them: the app menu macOS expects (About, Hide, Quit), the edit roles, and the window roles.
 * Nothing custom, so nothing to keep in sync.
 */
function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

ipcMain.handle('sessions:list', async () => withPrLinks(await listSessions(), await getPrLinks()));
ipcMain.handle('history:get', async (_event, id: string, known: number, generation: number): Promise<HistorySlice> => {
  const file = await findTranscript(id);
  // No transcript yet is a session nothing has been sent in: an empty history, not an error.
  if (!file) return NO_TRANSCRIPT;
  return readHistory(file, Number.isInteger(known) && known > 0 ? known : 0, Number.isInteger(generation) ? generation : 0);
});
ipcMain.handle('sessions:worktreeExists', (_event, repoRoot: string, name: string) => worktreeExists(repoRoot, name));
ipcMain.on('shell:openExternal', (_event, url: string) => {
  // Only ever hand the OS http(s) links, from whichever part of the window sent them — never file://, etc.
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
});
ipcMain.handle('sessions:delete', async (_event, id: string) => {
  // The renderer confirms via its own modal (a native dialog flickers under WSLg), so here we just do the deletion: move the files to trash, then drop the session from metadata.
  await trashSessions([id]);
  await purgeSession(id);
  await clearStatuses([id]);
  // A row that started it would otherwise lead back to a session that is gone.
  await forgetSessions([id]);
});
// Read once, as the app starts, since they change only with the app; what you change of them is `needsYou` in settings.json, applied by the settings' read.
const bundledNeedsYou = readBundledNeedsYou();
ipcMain.on('usage:review', (_event, act: unknown, scope: unknown, offered: unknown) => {
  const review = reviewUsageOf(act, scope, offered);
  if (review) void recordUsage([review]);
});
// A window opened again from the Dock follows no close of the app's, so the log has nothing to say of it.
ipcMain.handle('app:lastClosed', () => (reopened ? 'unknown' : lastClosed()));
registerMetaIpc();
registerGroupsIpc();
registerMarksIpc();
registerWindowIpc();
registerGeometry(currentWindow);
registerClipboardIpc();
registerTerminalIpc();
registerPanelsIpc();

void app.whenReady().then(async () => {
  installAppMenu();
  // Feeds the macOS About item, which the app menu above provides for free.
  app.setAboutPanelOptions({ applicationName: 'Claude UI', applicationVersion: app.getVersion() });
  // One-time: rewrite pins/open-tabs/finished stored under conversation keys to stable session ids.
  // First-wins over the recency-sorted list, so a family's conversationId maps to its latest member.
  const sessions = await listSessions();
  const conversationToId = new Map<string, string>();
  for (const s of sessions) if (!conversationToId.has(s.conversationId)) conversationToId.set(s.conversationId, s.id);
  await migrateToSessionKeys(conversationToId);
  await installStatusHooks();
  registerStatusIpc(currentWindow);
  // A transcript is also where an interrupt, and work stopped from claude's task list, are written, which no hook reports.
  registerSessionsWatcher(currentWindow, (file) => void transcriptChanged(file));
  registerConfig(currentWindow);
  registerLayoutState();
  registerSettings(currentWindow, () => bundledNeedsYou);
  // A session exists while a tab holds it (one that has sent nothing yet has no transcript), or while its transcript is on disk: looked at, not taken from the listing's cache, which can still name a file Claude Code's retention has since removed.
  registerPanelData(currentWindow, async (ids) => {
    const open = new Set(await getOpenSessions());
    const found = await Promise.all(
      ids.map(async (id) => {
        if (open.has(id)) return true;
        const file = await findTranscript(id);
        return file !== null && existsSync(file);
      }),
    );
    return new Set(ids.filter((_, index) => found[index]));
  });
  registerFolders();
  registerPrStatus();
  registerPrFind();
  // Before the window, so the answer is in hand by the time anyone can reach the maximize button.
  learnMaximizeInset();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && !reopening) void reopen();
  });
});

/** How long past the kill grace a quit, or a window opened again, waits, for a SIGKILL sent at the end of it to land and be seen. */
const GONE_MARGIN_MS = 500;

/** Until every session and run that was stopped has gone, and never longer than the kill grace and a moment for its SIGKILL. */
function allGone(): Promise<void> {
  return untilGone(() => liveTerminals() + liveRuns() > 0, KILL_GRACE_MS + GONE_MARGIN_MS);
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    return;
  }
  // macOS keeps the app running with no window, and a window opened again from the Dock starts afresh: its tabs come back from meta, and the ones that were running come back as `runningSessionsAtLaunch` says, started again when it says start.
  // So what ran in the closed window ends here as a quit ends it, rather than running on out of any window's reach until the app quits, beside a second copy the next window starts.
  // The window has gone by now, so nothing these exits do reaches the open and running tabs it kept in meta: the window opened again finds them as they were.
  terminateAll('the window closed');
  stopAllPanels();
});

/** A window being opened again on macOS, so a second click on the Dock during the wait opens no second one. */
let reopening = false;
/** Whether a window has been opened again on macOS since launch, whose sessions were ended by a window's close rather than the app's. */
let reopened = false;

/**
 * Open a window again on macOS once what the last one ran has gone, as a quit waits for it: the new window may start the sessions that were running afresh (`runningSessionsAtLaunch`), and before then would start each beside the one still on its way out.
 * Not during a quit, which closes windows rather than opening them.
 */
async function reopen(): Promise<void> {
  reopening = true;
  try {
    await allGone();
    if (quitting) return;
    reopened = true;
    await createWindow();
  } finally {
    reopening = false;
  }
}

// Give claude its time to leave before the app exits.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Tell the renderer we're shutting down before killing terminals, so the tab-close it triggers for each dying pty doesn't persist an empty open-tabs list over the real one.
  const mainWindow = currentWindow();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:quitting');
  // Where each panel's shell is, read before the sweep ends them, and kept as where its next shell starts.
  const folders = keepShellFolders(shellFolders());
  terminateAll('quitting');
  stopAllPanels();
  // Until everything stopped has gone and the shells' folders are kept, and never longer than the kill grace and a moment for its SIGKILL: a fixed wait would have to be that long every time, where claude sessions alone have gone within about 1.5 s.
  // A folder write that has not landed by then costs its shells their last `cd`, and holds up nothing.
  // The quit line goes last, once everything else has had its budget, because it is what tells the next launch this one ended on purpose.
  void Promise.all([allGone(), Promise.race([folders, new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + GONE_MARGIN_MS))])])
    .then(() => closeLog())
    .then(() => app.quit());
});
