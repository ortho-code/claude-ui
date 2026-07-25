import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeUiApi } from '../shared/types';

const api: ClaudeUiApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  getPinned: () => ipcRenderer.invoke('meta:getPinned'),
  togglePin: (id) => ipcRenderer.invoke('meta:togglePin', id),
  getAllStatuses: () => ipcRenderer.invoke('status:getAll'),
  onSessionStatus: (callback) =>
    ipcRenderer.on('session:status', (_event, id: string, status: string) => callback(id, status)),
  clearStatus: (id) => ipcRenderer.send('status:clear', id),
  startTerminal: (cwd, resumeSessionId) => ipcRenderer.invoke('terminal:start', cwd, resumeSessionId),
  onTerminalData: (callback) =>
    ipcRenderer.on('terminal:data', (_event, id: number, data: string) => callback(id, data)),
  onTerminalExit: (callback) =>
    ipcRenderer.on('terminal:exit', (_event, id: number, exitCode: number) => callback(id, exitCode)),
  sendTerminalInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  killTerminal: (id) => ipcRenderer.send('terminal:kill', id),
  closeTerminal: (id) => ipcRenderer.send('terminal:close', id),
};

contextBridge.exposeInMainWorld('claudeUi', api);
