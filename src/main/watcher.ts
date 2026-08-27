import { BrowserWindow } from 'electron';
import { watch, mkdirSync, type FSWatcher, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

/**
 * Watch ~/.claude/projects and tell the renderer when session transcripts change, so the sidebar updates without a manual refresh.
 * Recursive watch is unreliable on Linux/WSL, so we watch the root (new project folders) plus each project subdirectory (new/changed .jsonl) and add a watcher whenever a new folder appears.
 * Changes are debounced into one notification.
 */
export function registerSessionsWatcher(getWindow: () => BrowserWindow | null): void {
  mkdirSync(projectsDir, { recursive: true });
  const watchers = new Map<string, FSWatcher>();
  let timer: NodeJS.Timeout | null = null;

  const notify = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('sessions:changed');
    }, 600);
  };

  const watchDir = (dir: string, isRoot: boolean): void => {
    if (watchers.has(dir)) return;
    try {
      const watcher = watch(dir, () => {
        // A new project folder may have appeared under the root; start watching it too.
        if (isRoot) void watchProjectDirs();
        notify();
      });
      watchers.set(dir, watcher);
    } catch {
      // The directory vanished between readdir and watch; ignore.
    }
  };

  const watchProjectDirs = async (): Promise<void> => {
    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) watchDir(path.join(projectsDir, entry.name), false);
      }
    } catch {
      // Projects dir unreadable; nothing to watch yet.
    }
  };

  watchDir(projectsDir, true);
  void watchProjectDirs();
}
