import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { listSessions } from './sessions';

function createWindow(): void {
  const win = new BrowserWindow({
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

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

ipcMain.handle('sessions:list', () => listSessions());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
