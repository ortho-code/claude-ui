import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeUiApi } from '../shared/types';

const api: ClaudeUiApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  onSessionsChanged: (callback) => ipcRenderer.on('sessions:changed', () => callback()),
  getPinned: () => ipcRenderer.invoke('meta:getPinned'),
  togglePin: (id) => ipcRenderer.invoke('meta:togglePin', id),
  getArchived: () => ipcRenderer.invoke('meta:getArchived'),
  toggleArchive: (id) => ipcRenderer.invoke('meta:toggleArchive', id),
  deleteConversation: (payload) => ipcRenderer.invoke('sessions:delete', payload),
  getOpenSessions: () => ipcRenderer.invoke('meta:getOpenSessions'),
  setOpenSessions: (ids) => ipcRenderer.send('meta:setOpenSessions', ids),
  getActiveFolder: () => ipcRenderer.invoke('meta:getActiveFolder'),
  setActiveFolder: (folder) => ipcRenderer.send('meta:setActiveFolder', folder),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  getAllStatuses: () => ipcRenderer.invoke('status:getAll'),
  onSessionStatus: (callback) =>
    ipcRenderer.on('session:status', (_event, id: string, status: string, tab: string) =>
      callback(id, status, tab),
    ),
  clearStatus: (id) => ipcRenderer.send('status:clear', id),
  startTerminal: (cwd, resumeSessionId, tabToken) =>
    ipcRenderer.invoke('terminal:start', cwd, resumeSessionId, tabToken),
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
