import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeUiApi } from '../shared/types';

const api: ClaudeUiApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
};

contextBridge.exposeInMainWorld('claudeUi', api);
