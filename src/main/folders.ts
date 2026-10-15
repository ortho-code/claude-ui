import { dialog, ipcMain, shell } from 'electron';
import { mkdirSync } from 'node:fs';
import type { FolderName } from '../shared/folders';
import { configRoot, logsDir } from './paths';

const FOLDERS: Record<FolderName, string> = { config: configRoot, logs: logsDir };

/**
 * The folders Settings shows and opening one in the file manager, and the picker + New asks for a session's folder with.
 * The window names a folder to open and never sends a path, so opening is limited to these; a name that is not one of them does nothing.
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
  ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
    // `showHiddenFiles` reaches the picker on macOS; Electron 43 does not pass it on to Linux's.
    // There the desktop portal's GTK picker follows GTK's own setting, which Ctrl+H toggles and the picker remembers, while Chromium's own GTK picker, its fallback below portal version 3, opens with hidden folders off every time.
    // `createDirectory` is what turns on the New Folder control in macOS's picker; Linux ignores it, and Chromium's own GTK picker offers one either way.
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'showHiddenFiles', 'createDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
}
