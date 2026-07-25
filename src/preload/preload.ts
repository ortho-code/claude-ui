import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeUiApi } from '../shared/types';

const api: ClaudeUiApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  startTerminal: (cwd, resumeSessionId) => ipcRenderer.invoke('terminal:start', cwd, resumeSessionId),
  onTerminalData: (callback) =>
    ipcRenderer.on('terminal:data', (_event, id: number, data: string) => callback(id, data)),
  onTerminalExit: (callback) =>
    ipcRenderer.on('terminal:exit', (_event, id: number, exitCode: number) => callback(id, exitCode)),
  sendTerminalInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  resizeTerminal: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  killTerminal: (id) => ipcRenderer.send('terminal:kill', id),
};

contextBridge.exposeInMainWorld('claudeUi', api);
