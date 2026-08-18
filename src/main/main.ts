import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron';
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
  getActiveProject,
  setActiveProject,
  getProjectNames,
  setProjectName,
  migrateToSessionKeys,
  purgeSession,
  auditMarker,
} from './meta';
import { installStatusHooks, registerStatusIpc, clearStatuses } from './status';
import { registerSessionsWatcher } from './watcher';

let mainWindow: BrowserWindow | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'claude-ui',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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
ipcMain.on('meta:setOpenSessions', (_event, ids: string[]) => {
  void setOpenSessions(ids);
});
ipcMain.handle('meta:getActiveProject', () => getActiveProject());
ipcMain.on('meta:setActiveProject', (_event, folder: string | null) => {
  void setActiveProject(folder);
});
ipcMain.handle('meta:getProjectNames', () => getProjectNames());
ipcMain.handle('meta:setProjectName', (_event, repoRoot: string, name: string) => setProjectName(repoRoot, name));
registerTerminalIpc();

app.whenReady().then(async () => {
  // No application menu: we don't want the default File/Edit/View items (reload, dev tools,
  // view source). The app drives everything from its own UI.
  Menu.setApplicationMenu(null);
  // One-time: rewrite pins/open-tabs/archived stored under conversation keys to stable session ids.
  // First-wins over the recency-sorted list, so a family's conversationId maps to its latest member.
  const sessions = await listSessions();
  const conversationToId = new Map<string, string>();
  for (const s of sessions) if (!conversationToId.has(s.conversationId)) conversationToId.set(s.conversationId, s.id);
  await migrateToSessionKeys(conversationToId);
  void auditMarker('STARTUP'); // temporary debug aid: mark the restart boundary + trim old segments
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
  void auditMarker('QUITTING'); // temporary debug aid: mark where a run ended
  // Tell the renderer we're shutting down before killing terminals, so the tab-close it triggers
  // for each dying pty doesn't persist an empty open-tabs list over the real one.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:quitting');
  terminateAll();
  setTimeout(() => app.quit(), 1500);
});
