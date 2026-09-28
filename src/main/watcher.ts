import type { BrowserWindow } from 'electron';
import { watch, mkdirSync, type FSWatcher, promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fsFailure, log } from './log';

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
    } catch (error) {
      // A directory that vanished between readdir and watch is not worth a line. Anything else — the inotify limit (ENOSPC) above all — leaves that project's sessions without live updates, with nothing on screen to say so.
      const failure = fsFailure(error);
      if (failure) log('warn', 'watch', `cannot watch ${dir}: ${failure}`);
    }
  };

  const watchProjectDirs = async (): Promise<void> => {
    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) watchDir(path.join(projectsDir, entry.name), false);
      }
    } catch (error) {
      // Not there yet is nothing to watch yet; unreadable is worth knowing.
      const failure = fsFailure(error);
      if (failure) log('warn', 'watch', `cannot list ${projectsDir}: ${failure}`);
    }
  };

  watchDir(projectsDir, true);
  void watchProjectDirs();
}
