import { app, BrowserWindow, ipcMain, Menu, dialog, shell } from 'electron';
import * as path from 'node:path';
import { listSessions, trashSessions } from './sessions';
import { registerTerminalIpc, terminateAll } from './terminal';
import {
  getPinned,
  togglePin,
  getArchived,
  toggleArchive,
  getOpenSessions,
  setOpenSessions,
  migrateToConversationKeys,
  purgeConversation,
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
ipcMain.handle('meta:getPinned', () => getPinned());
ipcMain.handle('meta:togglePin', (_event, id: string) => togglePin(id));
ipcMain.on('shell:openExternal', (_event, url: string) => {
  // Only ever hand the OS http(s) links from terminal output — never file://, etc.
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
});
ipcMain.handle('meta:getArchived', () => getArchived());
ipcMain.handle('meta:toggleArchive', (_event, id: string) => toggleArchive(id));
ipcMain.handle('sessions:delete', async (_event, payload: { conversationId: string; ids: string[] }) => {
  // The renderer confirms via its own modal (a native dialog flickers under WSLg), so here we
  // just do the deletion: move files to trash, then drop the conversation from metadata.
  await trashSessions(payload.ids);
  await purgeConversation(payload.conversationId);
  await clearStatuses(payload.ids);
});
ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});
ipcMain.handle('meta:getOpenSessions', () => getOpenSessions());
ipcMain.on('meta:setOpenSessions', (_event, ids: string[]) => {
  void setOpenSessions(ids);
});
registerTerminalIpc();

app.whenReady().then(async () => {
  // No application menu: we don't want the default File/Edit/View items (reload, dev tools,
  // view source). The app drives everything from its own UI.
  Menu.setApplicationMenu(null);
  // One-time: rewrite pins/open-tabs stored as raw session ids to conversation keys.
  const sessions = await listSessions();
  await migrateToConversationKeys(new Map(sessions.map((s) => [s.id, s.conversationId])));
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
  terminateAll();
  setTimeout(() => app.quit(), 1500);
});
