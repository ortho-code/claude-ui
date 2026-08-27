import { app } from 'electron';
import * as path from 'node:path';

/**
 * The one place that decides where claude-ui keeps its own data, and the reason it exists as a
 * module: the decision has to be made before anything reads a path.
 *
 * `productName` is "Claude UI" — what the installer, the Applications folder and the window title
 * show. But `app.getName()` returns `productName` when it is set, and `app.getPath('userData')` is
 * built from it, so shipping the pretty name alone would move the data directory from
 * `~/.config/claude-ui` to `~/.config/Claude UI` and orphan every pin, group, note, project order
 * and restored tab — silently, with no error, on first launch of the packaged app. The pin below
 * keeps the data under the original name for good.
 *
 * On Linux `appData` is `~/.config`, so this resolves to exactly the directory the app has always
 * used and the pin is a no-op. On macOS it is `~/Library/Application Support`, which gives the
 * status files and the hook script the same home as `meta.json` instead of splitting them between
 * `~/.config` and Library.
 *
 * Import this module before any other path use. `app.setPath` runs on import, and a module that
 * computes a path at load time (status.ts does) would otherwise capture the unpinned value.
 */
app.setPath('userData', path.join(app.getPath('appData'), 'claude-ui'));

/** Everything claude-ui owns lives here: meta.json, the status files, and the hook script. */
export const configDir = app.getPath('userData');

/** One file per session, written by the hook script and watched by the app. */
export const statusDir = path.join(configDir, 'status');

/** The hook script itself, rewritten on every launch so its contents can change between versions. */
export const hookScriptPath = path.join(configDir, 'status-hook.sh');

/**
 * claude-ui-owned settings file, passed to claude via `--settings` (terminal.ts); holds our hooks
 * only. Keeps the status hooks out of the user's ~/.claude/settings.json (which may be tracked).
 */
export const statusSettingsFile = path.join(configDir, 'claude-settings.json');

/**
 * Quote a path for the single shell command string that claude runs a hook through. macOS makes this
 * necessary: `~/Library/Application Support/...` contains a space, so an unquoted path would reach
 * the hook as two arguments and simply not run.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
