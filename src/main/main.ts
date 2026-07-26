import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { listSessions } from './sessions';
import { registerTerminalIpc, terminateAll } from './terminal';
import { getPinned, togglePin, getOpenSessions, setOpenSessions } from './meta';
import { installStatusHooks, registerStatusIpc } from './status';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'claude-ui',
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
ipcMain.handle('meta:getOpenSessions', () => getOpenSessions());
ipcMain.on('meta:setOpenSessions', (_event, ids: string[]) => {
  void setOpenSessions(ids);
});
registerTerminalIpc();

app.whenReady().then(async () => {
  await installStatusHooks();
  registerStatusIpc(() => mainWindow);
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
