// First, and for its side effect: paths.ts pins the userData directory, and must run before any module computes a path from it. See the comment there.
import './paths';
import { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { listSessions, trashSessions, worktreeExists } from './sessions';
import { registerTerminalIpc, terminateAll } from './terminal';
import {
  getPinned,
  togglePin,
  getArchived,
  toggleArchive,
  getOpenSessions,
  setOpenSessions,
  getActiveSession,
  getActiveSessionByProject,
  setActiveSession,
  getActiveProject,
  setActiveProject,
  getProjectNames,
  getNotes,
  setNote,
  getFooterExpanded,
  setFooterExpanded,
  setProjectName,
  getGroupState,
  createGroup,
  renameGroup,
  deleteGroup,
  moveSessionToGroup,
  moveGroup,
  getProjectOrder,
  seedProjectOrder,
  moveProject,
  migrateToSessionKeys,
  purgeSession,
  getWindowBounds,
  setWindowBounds,
  getUiState,
  setUiState,
} from './meta';
import { placeWindow } from './bounds';
import { installStatusHooks, registerStatusIpc, clearStatuses } from './status';
import { registerSessionsWatcher } from './watcher';
import type { OrderMove, UiState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

/**
 * Window title, and the app's only always-visible version stamp. See createWindow.
 * The dev suffix matters because the two are otherwise identical: same name, same version, same icon, and the same data directory, so there is nothing on screen to say whether you are looking at the installed app or one started from source. `app.isPackaged` is derived rather than configured, so it cannot drift.
 */
const appTitle = `Claude UI ${app.getVersion()}${app.isPackaged ? '' : ' — dev'}`;

// `--no-sandbox` cannot be set from inside the app.
// Do NOT try `app.commandLine.appendSwitch('no-sandbox')`: it was tried and reverted, because it runs too late for the renderer, which then dies with a FATAL about /dev/shm permissions (misleading — /dev/shm is fine) and leaves an empty window painted in the background colour.
// Measured both ways with a throwaway XDG_CONFIG_HOME: argv flag clean, appendSwitch fatal.
// The switch has to be on the command line before Electron starts, so it belongs to whatever launches the app — the `start` script in development, and the packaged launcher's own arguments once there is one.

// The app stays on X11 (Xwayland) under WSLg.
// Do NOT add --ozone-platform=wayland: it paints this window solid white, with or without app.disableHardwareAcceleration().
// Both were tried and reverted.
// See docs/architecture.md, including the note on an all-arrow cursor, which looks like an X11 limitation but is WSLg's pointer state stuck.

// Only one claude-ui instance at a time; a second launch focuses the existing window. This may change if we add pop-out / multi-window sessions later.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
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

/**
 * Is the `claude` CLI actually installed?
 * Asked through a login+interactive shell for the same reason terminal.ts spawns one: on this kind of setup `claude` arrives on PATH via mise/asdf/direnv activation in the shell rc, which a non-interactive shell skips entirely.
 *
 * This has never been false on the development machine, which is exactly why it needs asking: an install without the CLI would otherwise open every tab on "command not found", which reads as this app being broken rather than as a missing prerequisite.
 */
function claudeIsInstalled(): Promise<boolean> {
  const shell = process.env.SHELL ?? '/bin/bash';
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', 'command -v claude'], { timeout: 15_000 }, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

/**
 * The window icon, read as BYTES rather than handed over as a path.
 *
 * `BrowserWindow`'s `icon` option is consumed by native code, which does not go through Electron's asar-aware fs layer.
 * Once packaged, `…/resources/app.asar/assets/icon.png` is therefore a path that does not exist on disk: the icon silently fails to load, X11 gets no `_NET_WM_ICON`, and the window shows the desktop's generic fallback instead.
 * It only appears when packaged, because in development `assets/` is a real directory.
 * Node's `fs` does read inside the asar, so loading the bytes here behaves identically both ways with nothing to unpack.
 *
 * Resized down from the 1024px source that macOS needs: this one is drawn at taskbar size, and Electron's own filtering beats leaving a window manager to crush 1024px into 32.
 */
function windowIcon(): NativeImage | undefined {
  try {
    const png = readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    return nativeImage.createFromBuffer(png).resize({ width: 256, height: 256, quality: 'best' });
  } catch {
    return undefined; // A default icon is a far better outcome than no window.
  }
}

/**
 * Persist the window's geometry as it changes.
 *
 * Debounced because `resize` and `move` fire continuously while a window is being dragged, and every write here is a full read-modify-write of meta.json plus an audit line; one write per gesture is what is wanted, not one per frame.
 * The `close` handler flushes rather than schedules, since the last resize before quitting is exactly the one worth keeping and there is no later tick to run it in.
 *
 * `getNormalBounds` rather than `getBounds`: while maximized the latter reports the maximized rectangle, so saving it would grow the window to the screen and lose the size to go back to.
 */
function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = (): void => {
    if (win.isDestroyed()) return;
    const { x, y, width, height } = win.getNormalBounds();
    void setWindowBounds({ x, y, width, height, maximized: win.isMaximized() });
  };
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      save();
    }, 400);
  };
  // One per line rather than a loop over the names: BrowserWindow.on is overloaded per event, so a union of event names does not type-check.
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

/** Bigger than any title bar. A difference larger than this is the window manager placing the window by a policy of its own, or the user already dragging it — not a frame, and not ours to cancel. */
const MAX_FRAME = 64;
/** How long to wait for the frame to appear before giving up on there being one. Measured at ~250ms here, with a trivial window and with the real one alike, so this is eight times the margin it needs. */
const FRAME_DEADLINE_MS = 2000;

/**
 * Cancel the frame offset this window manager adds to every position it is given.
 *
 * Measured under WSLg: asking for 300,200 — at creation, through setPosition, or through setBounds alike — lands the window at 306,227, and that is also what reading the bounds back reports.
 * So storing the position on close and asking for it again on launch walks the window down and to the right by one title bar every single time.
 * Since the same offset applies to a request as to a reading, asking for `wanted - offset` lands exactly on `wanted`.
 *
 * POLLED rather than driven by an event, and that is the whole subtlety: the first `move` fires while the bounds still read back exactly what was asked for, and the frame only appears some 40ms later.
 * Correcting on `move` would therefore measure an offset of zero and quietly leave the drift in place — which is the failure this is here to prevent, so it must not be the failure it ships with.
 * On a window manager that adds no offset, nothing ever differs, the deadline passes, and no correction is made.
 */
function correctFramePlacement(win: BrowserWindow, wanted: { x: number; y: number }): void {
  const started = Date.now();
  const tick = (): void => {
    // Nothing to correct on a maximized window, and nothing to correct on one that has gone away.
    if (win.isDestroyed() || win.isMaximized()) return;
    const { x, y } = win.getBounds();
    const dx = x - wanted.x;
    const dy = y - wanted.y;
    // A frame-sized difference is the offset this exists to cancel. Take it and stop.
    if ((dx !== 0 || dy !== 0) && Math.abs(dx) <= MAX_FRAME && Math.abs(dy) <= MAX_FRAME) {
      win.setPosition(wanted.x - dx, wanted.y - dy);
      return;
    }
    // Everything else means "not settled yet", and MUST keep polling rather than conclude anything.
    // Two readings arrive before the real one: the position we asked for, unchanged, and — for the first ~50ms, while the window is not yet mapped — the far off-screen coordinates X11 parks it at, measured here as about -32700 on both axes.
    // Treating either as an answer is what made an earlier version of this give up at 54ms and never see the offset that arrived at ~250ms.
    if (Date.now() - started < FRAME_DEADLINE_MS) setTimeout(tick, 25);
  };
  setTimeout(tick, 25);
}

async function createWindow(): Promise<void> {
  // Reading this before the window exists is the point: bounds have to be constructor arguments, since assigning them afterwards makes the window visibly jump from the default position to the stored one.
  const placement = placeWindow(
    await getWindowBounds(),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    width: placement?.width ?? 1100,
    height: placement?.height ?? 760,
    // Undefined leaves placement to the platform, which is what we want both on a first run and when the stored position is no longer on any screen.
    x: placement?.x,
    y: placement?.y,
    title: appTitle,
    icon: windowIcon(),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // After construction, unlike the size: maximizing is a state change rather than a geometry argument, and doing it here keeps the normal bounds above as the size to return to.
  if (placement?.maximized) mainWindow.maximize();
  // Only when a position was actually restored: on a first run the window manager places the window, and wherever it puts it is by definition where it belongs.
  else if (placement?.x !== undefined && placement.y !== undefined) {
    correctFramePlacement(mainWindow, { x: placement.x, y: placement.y });
  }
  trackBounds(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    // index.html carries its own <title>, which wins over the BrowserWindow option, so set it here instead.
    // Without auto-update the version has to be visible somewhere, and the title bar is where someone asked "which version are you on?" will actually look.
    mainWindow?.setTitle(appTitle);
    void claudeIsInstalled().then((installed) => {
      if (installed || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('app:claude-missing');
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('sessions:list', () => listSessions());
ipcMain.handle('sessions:worktreeExists', (_event, repoRoot: string, name: string) => worktreeExists(repoRoot, name));
ipcMain.handle('meta:getPinned', () => getPinned());
ipcMain.handle('meta:togglePin', (_event, id: string) => togglePin(id));
ipcMain.on('shell:openExternal', (_event, url: string) => {
  // Only ever hand the OS http(s) links from terminal output — never file://, etc.
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
});
ipcMain.handle('meta:getArchived', () => getArchived());
ipcMain.handle('meta:toggleArchive', (_event, id: string) => toggleArchive(id));
ipcMain.handle('sessions:delete', async (_event, id: string) => {
  // The renderer confirms via its own modal (a native dialog flickers under WSLg), so here we just do the deletion: move the files to trash, then drop the session from metadata.
  await trashSessions([id]);
  await purgeSession(id);
  await clearStatuses([id]);
});
ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});
ipcMain.handle('meta:getOpenSessions', () => getOpenSessions());
ipcMain.handle('meta:getActiveSession', () => getActiveSession());
ipcMain.handle('meta:getActiveSessionByProject', () => getActiveSessionByProject());
ipcMain.on('meta:setActiveSession', (_event, id: string | null, repoRoot?: string) => {
  void setActiveSession(id, repoRoot);
});
ipcMain.on('meta:setOpenSessions', (_event, ids: string[]) => {
  void setOpenSessions(ids);
});
ipcMain.handle('meta:getActiveProject', () => getActiveProject());
ipcMain.on('meta:setActiveProject', (_event, folder: string | null) => {
  void setActiveProject(folder);
});
ipcMain.handle('meta:getNotes', () => getNotes());
ipcMain.handle('meta:setNote', (_event, id: string, note: string) => setNote(id, note));
ipcMain.handle('meta:getFooterExpanded', () => getFooterExpanded());
ipcMain.on('meta:setFooterExpanded', (_event, expanded: boolean) => {
  void setFooterExpanded(expanded);
});
ipcMain.handle('meta:getUiState', () => getUiState());
ipcMain.on('meta:setUiState', (_event, state: UiState) => {
  void setUiState(state);
});
ipcMain.handle('meta:getProjectNames', () => getProjectNames());
ipcMain.handle('meta:setProjectName', (_event, repoRoot: string, name: string) => setProjectName(repoRoot, name));
ipcMain.handle('meta:getGroupState', () => getGroupState());
ipcMain.handle('meta:createGroup', (_event, name: string, repoRoot: string | null, sessionId?: string) =>
  createGroup(name, repoRoot, sessionId),
);
ipcMain.handle('meta:renameGroup', (_event, id: string, name: string) => renameGroup(id, name));
ipcMain.handle('meta:deleteGroup', (_event, id: string) => deleteGroup(id));
ipcMain.handle('meta:moveGroup', (_event, id: string, move: OrderMove) => moveGroup(id, move));
ipcMain.handle('meta:getProjectOrder', () => getProjectOrder());
ipcMain.handle('meta:seedProjectOrder', (_event, roots: string[]) => seedProjectOrder(roots));
ipcMain.handle('meta:moveProject', (_event, repoRoot: string, move: OrderMove) => moveProject(repoRoot, move));
ipcMain.handle('meta:moveSessionToGroup', (_event, sessionId: string, groupId: string | null) =>
  moveSessionToGroup(sessionId, groupId),
);
registerTerminalIpc();

app.whenReady().then(async () => {
  installAppMenu();
  // Feeds the macOS About item, which the app menu above provides for free.
  app.setAboutPanelOptions({ applicationName: 'Claude UI', applicationVersion: app.getVersion() });
  // One-time: rewrite pins/open-tabs/archived stored under conversation keys to stable session ids. First-wins over the recency-sorted list, so a family's conversationId maps to its latest member.
  const sessions = await listSessions();
  const conversationToId = new Map<string, string>();
  for (const s of sessions) if (!conversationToId.has(s.conversationId)) conversationToId.set(s.conversationId, s.id);
  await migrateToSessionKeys(conversationToId);
  await installStatusHooks();
  registerStatusIpc(() => mainWindow);
  registerSessionsWatcher(() => mainWindow);
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Give claude a moment to flush before the app exits.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Tell the renderer we're shutting down before killing terminals, so the tab-close it triggers for each dying pty doesn't persist an empty open-tabs list over the real one.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:quitting');
  terminateAll();
  setTimeout(() => app.quit(), 1500);
});
