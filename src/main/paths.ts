import { app } from 'electron';
import * as path from 'node:path';

/**
 * The one place that decides where claude-ui keeps its own data, and the reason it exists as a module: the decision has to be made before anything reads a path.
 *
 * `productName` is "Claude UI" — what the installer, the Applications folder and the window title show.
 * But `app.getName()` returns `productName` when it is set, and `app.getPath('userData')` is built from it, so shipping the pretty name alone would move the data directory from `~/.config/claude-ui` to `~/.config/Claude UI` and orphan every pin, group, note, project order and restored tab — silently, with no error, on first launch of the packaged app.
 * The pin below keeps the data under the original name for good.
 *
 * On Linux `appData` is `~/.config`, so this resolves to exactly the directory the app has always used and the pin is a no-op.
 * On macOS it is `~/Library/Application Support`, which gives the status files and the hook script the same home as `meta.json` instead of splitting them between `~/.config` and Library.
 *
 * Import this module before any other path use. `app.setPath` runs on import, and a module that computes a path at load time (status.ts does) would otherwise capture the unpinned value.
 */
app.setPath('userData', path.join(app.getPath('appData'), 'claude-ui'));

/** Everything claude-ui owns lives here: meta.json, the status files, and the hook script. */
export const configDir = app.getPath('userData');

/**
 * The app's log files (log.ts): `~/.config/claude-ui/logs` on Linux, `~/Library/Logs/Claude UI` on macOS, where a Mac keeps logs.
 * Read here, below the pin, and nowhere else: the call creates the folder as a side effect, and made before the pin on Linux it resolves under `productName` and leaves a stray `~/.config/Claude UI/logs` behind.
 * On macOS it follows the app's name rather than `userData`, so the pin does not move it.
 */
export const logsDir = app.getPath('logs');

/** One file per session, written by the hook script and watched by the app. */
export const statusDir = path.join(configDir, 'status');

/** The hook script itself, rewritten on every launch so its contents can change between versions. */
export const hookScriptPath = path.join(configDir, 'status-hook.sh');

/**
 * claude-ui-owned settings file, passed to claude via `--settings` (terminal.ts); holds our hooks only. Keeps the status hooks out of the user's ~/.claude/settings.json (which may be tracked).
 */
export const statusSettingsFile = path.join(configDir, 'claude-settings.json');

/**
 * The folder for everything a person may EDIT or SHARE — the layout file and the scripts it points at — and nothing else.
 * One folder apart from `meta.json` and the status files, which are the app's own and never meant for an editor, so "copy this folder" hands a colleague exactly the customisation and none of the machine state.
 * The app creates it, reads it and watches it; in this version it never writes into it.
 */
export const configRoot = path.join(configDir, 'config');

/** `layouts/` rather than a single file, so named and per-project layouts are added beside the default rather than by moving it. */
export const layoutsDir = path.join(configRoot, 'layouts');

/** Where a `script` belongs; a relative `script` resolves against the config folder, so `scripts/x.sh` travels with it. */
export const scriptsDir = path.join(configRoot, 'scripts');

/** Panel types of a person's own, a folder each: its `panel.json` and the script it runs. The folder's name is the type's, so a folder is shared by copying it. */
export const typesDir = path.join(configRoot, 'types');

export const defaultLayoutFile = path.join(layoutsDir, 'default.json');

/**
 * Quote a path for the single shell command string that claude runs a hook through.
 * macOS makes this necessary: `~/Library/Application Support/...` contains a space, so an unquoted path would reach the hook as two arguments and simply not run.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
