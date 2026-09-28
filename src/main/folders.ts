import { ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import type { FolderName } from '../shared/folders';
import { configRoot, logsDir } from './paths';

const FOLDERS: Record<FolderName, string> = { config: configRoot, logs: logsDir };

/**
 * The folders Settings shows, and opening one in the file manager.
 * The window names a folder and never sends a path, so opening is limited to these; a name that is not one of them does nothing.
 */
export function registerFolders(): void {
  ipcMain.handle('folders:get', () => FOLDERS);
  ipcMain.on('folder:open', (_event, name: FolderName) => {
    if (!Object.hasOwn(FOLDERS, name)) return;
    const dir = FOLDERS[name];
    // Made again first: Settings invites deleting the logs, and a folder deleted whole cannot be opened.
    mkdirSync(dir, { recursive: true });
    // `openPath`, not `showItemInFolder`: that one opens the folder's PARENT with the folder selected, and a Linux file manager without FileManager1 support (WSLg's) selects nothing, which reads as the wrong folder.
    void shell.openPath(dir);
  });
}
