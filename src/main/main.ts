// First, and for its side effect: paths.ts pins the userData directory, and must run before any
// module computes a path from it. See the comment there.
import './paths';
import { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeImage } from 'electron';
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
} from './meta';
import { installStatusHooks, registerStatusIpc, clearStatuses } from './status';
import { registerSessionsWatcher } from './watcher';
import type { OrderMove } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

/** Window title, and the app's only always-visible version stamp. See createWindow. */
const appTitle = `Claude UI ${app.getVersion()}`;

// `--no-sandbox` cannot be set from inside the app. Do NOT try
// `app.commandLine.appendSwitch('no-sandbox')`: it was tried and reverted, because it runs too late
// for the renderer, which then dies with a FATAL about /dev/shm permissions (misleading — /dev/shm is
// fine) and leaves an empty window painted in the background colour. Measured both ways with a
// throwaway XDG_CONFIG_HOME: argv flag clean, appendSwitch fatal. The switch has to be on the command
// line before Electron starts, so it belongs to whatever launches the app — the `start` script in
// development, and the packaged launcher's own arguments once there is one.

// The app stays on X11 (Xwayland) under WSLg. Do NOT add --ozone-platform=wayland: it paints this
// window solid white, with or without app.disableHardwareAcceleration(). Both were tried and
// reverted. See docs/architecture.md, including the note on an all-arrow cursor, which looks like an
// X11 limitation but is WSLg's pointer state stuck.

// Only one claude-ui instance at a time; a second launch focuses the existing window.
// This may change if we add pop-out / multi-window sessions later.
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
 * On Linux there is none, so the default File/Edit/View items — reload, dev tools, view source —
 * stay out of a UI that drives everything itself.
 *
 * macOS cannot afford that. There, Cmd+C/V/X/A/Z are delivered by menu ROLES, not by the focused web
 * contents, so a null menu silently costs copy and paste everywhere, the terminal included. This is
 * the smallest menu that keeps them: the app menu macOS expects (About, Hide, Quit), the edit roles,
 * and the window roles. Nothing custom, so nothing to keep in sync.
 */
function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

/**
 * Is the `claude` CLI actually installed? Asked through a login+interactive shell for the same
 * reason terminal.ts spawns one: on this kind of setup `claude` arrives on PATH via mise/asdf/direnv
 * activation in the shell rc, which a non-interactive shell skips entirely.
 *
 * This has never been false on the development machine, which is exactly why it needs asking now:
 * the first colleague to install the app without the CLI would otherwise get "command not found"
 * inside a terminal tab and reasonably conclude the app is broken.
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
 * `BrowserWindow`'s `icon` option is consumed by native code, which does not go through Electron's
 * asar-aware fs layer. Once packaged, `…/resources/app.asar/assets/icon.png` is therefore a path
 * that does not exist on disk: the icon silently fails to load, X11 gets no `_NET_WM_ICON`, and the
 * window shows the desktop's generic fallback instead. It only appears when packaged, because in
 * development `assets/` is a real directory. Node's `fs` does read inside the asar, so loading the
 * bytes here behaves identically both ways with nothing to unpack.
 *
 * Resized down from the 1024px source that macOS needs: this one is drawn at taskbar size, and
 * Electron's own filtering beats leaving a window manager to crush 1024px into 32.
 */
function windowIcon(): NativeImage | undefined {
  try {
    const png = readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    return nativeImage.createFromBuffer(png).resize({ width: 256, height: 256, quality: 'best' });
  } catch {
    return undefined; // A default icon is a far better outcome than no window.
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: appTitle,
    icon: windowIcon(),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    // index.html carries its own <title>, which wins over the BrowserWindow option, so set it here
    // instead. Without auto-update the version has to be visible somewhere, and the title bar is
    // where someone asked "which version are you on?" will actually look.
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
  // The renderer confirms via its own modal (a native dialog flickers under WSLg), so here we
  // just do the deletion: move the files to trash, then drop the session from metadata.
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
  // One-time: rewrite pins/open-tabs/archived stored under conversation keys to stable session ids.
  // First-wins over the recency-sorted list, so a family's conversationId maps to its latest member.
  const sessions = await listSessions();
  const conversationToId = new Map<string, string>();
  for (const s of sessions) if (!conversationToId.has(s.conversationId)) conversationToId.set(s.conversationId, s.id);
  await migrateToSessionKeys(conversationToId);
  await installStatusHooks();
  registerStatusIpc(() => mainWindow);
  registerSessionsWatcher(() => mainWindow);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
  // Tell the renderer we're shutting down before killing terminals, so the tab-close it triggers
  // for each dying pty doesn't persist an empty open-tabs list over the real one.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:quitting');
  terminateAll();
  setTimeout(() => app.quit(), 1500);
});
