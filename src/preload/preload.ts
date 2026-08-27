import { contextBridge, ipcRenderer } from 'electron';
import type { ClaudeUiApi } from '../shared/types';

const api: ClaudeUiApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  worktreeExists: (repoRoot, name) => ipcRenderer.invoke('sessions:worktreeExists', repoRoot, name),
  onSessionsChanged: (callback) => ipcRenderer.on('sessions:changed', () => callback()),
  onQuitting: (callback) => ipcRenderer.on('app:quitting', () => callback()),
  onClaudeMissing: (callback) => ipcRenderer.on('app:claude-missing', () => callback()),
  getPinned: () => ipcRenderer.invoke('meta:getPinned'),
  togglePin: (id) => ipcRenderer.invoke('meta:togglePin', id),
  getArchived: () => ipcRenderer.invoke('meta:getArchived'),
  toggleArchive: (id) => ipcRenderer.invoke('meta:toggleArchive', id),
  deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
  getOpenSessions: () => ipcRenderer.invoke('meta:getOpenSessions'),
  setOpenSessions: (ids) => ipcRenderer.send('meta:setOpenSessions', ids),
  getActiveSession: () => ipcRenderer.invoke('meta:getActiveSession'),
  getActiveSessionByProject: () => ipcRenderer.invoke('meta:getActiveSessionByProject'),
  setActiveSession: (id, repoRoot) => ipcRenderer.send('meta:setActiveSession', id, repoRoot),
  getActiveProject: () => ipcRenderer.invoke('meta:getActiveProject'),
  setActiveProject: (folder) => ipcRenderer.send('meta:setActiveProject', folder),
  getNotes: () => ipcRenderer.invoke('meta:getNotes'),
  setNote: (id, note) => ipcRenderer.invoke('meta:setNote', id, note),
  getFooterExpanded: () => ipcRenderer.invoke('meta:getFooterExpanded'),
  setFooterExpanded: (expanded) => ipcRenderer.send('meta:setFooterExpanded', expanded),
  getProjectNames: () => ipcRenderer.invoke('meta:getProjectNames'),
  setProjectName: (repoRoot, name) => ipcRenderer.invoke('meta:setProjectName', repoRoot, name),
  getGroupState: () => ipcRenderer.invoke('meta:getGroupState'),
  createGroup: (name, repoRoot, sessionId) => ipcRenderer.invoke('meta:createGroup', name, repoRoot, sessionId),
  renameGroup: (id, name) => ipcRenderer.invoke('meta:renameGroup', id, name),
  deleteGroup: (id) => ipcRenderer.invoke('meta:deleteGroup', id),
  moveSessionToGroup: (sessionId, groupId) => ipcRenderer.invoke('meta:moveSessionToGroup', sessionId, groupId),
  moveGroup: (id, move) => ipcRenderer.invoke('meta:moveGroup', id, move),
  getProjectOrder: () => ipcRenderer.invoke('meta:getProjectOrder'),
  seedProjectOrder: (roots) => ipcRenderer.invoke('meta:seedProjectOrder', roots),
  moveProject: (repoRoot, move) => ipcRenderer.invoke('meta:moveProject', repoRoot, move),
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  openExternal: (url) => ipcRenderer.send('shell:openExternal', url),
  getAllStatuses: () => ipcRenderer.invoke('status:getAll'),
  onSessionStatus: (callback) =>
    ipcRenderer.on('session:status', (_event, id: string, status: string, tab: string) =>
      callback(id, status, tab),
    ),
  clearStatus: (id) => ipcRenderer.send('status:clear', id),
  startTerminal: (cwd, resumeSessionId, tabToken, fork, name, worktree) =>
    ipcRenderer.invoke('terminal:start', cwd, resumeSessionId, tabToken, fork, name, worktree),
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
