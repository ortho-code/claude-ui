import { ipcMain, shell } from 'electron';
import { errorText, log } from '../logs/log';
import { readProcVersion, run, runsOnWsl, type Run } from './platform';

/**
 * Opening a link in the browser, for every part of the window that has one: a PR in a menu, a link in a terminal or the history, a panel's row.
 * A link that could not be opened is logged and told to the window, which says so (docs/architecture/window.md § Links).
 */

/** Opens a link, rejecting with what went wrong. */
export type Open = (url: string) => Promise<void>;

/** How long Windows may take to take a link: rundll32.exe hands it to the browser and returns, in about 130 ms when measured (2026-11-13), so this leaves room for a cold start while a broken way to Windows still shows soon. */
const WINDOWS_TIMEOUT_MS = 3_000;

/** Where rundll32.exe is when WSL's interop leaves Windows off `PATH`. */
const RUNDLL32_FALLBACK = '/mnt/c/Windows/System32/rundll32.exe';

const WEB_LINK = /^https?:\/\//i;

const missing = (error: unknown): boolean => (error as { code?: unknown }).code === 'ENOENT';

/**
 * Hand a link to Windows' own handler for it, the call `xdg-open` (xdg-utils 1.2.1) makes under WSL as well.
 * Made by the app rather than through `xdg-open`, so that a call Windows does not take, as when the app's way to Windows has broken, fails here, where it can be told.
 * Only a failure to reach Windows shows: rundll32.exe gives no exit code for whether the browser took the link.
 */
export function throughWindows(runner: Run = run): Open {
  const args = (url: string): string[] => ['url.dll,FileProtocolHandler', url];
  return async (url) => {
    try {
      await runner('rundll32.exe', args(url), WINDOWS_TIMEOUT_MS);
    } catch (error) {
      if (!missing(error)) throw error;
      await runner(RUNDLL32_FALLBACK, args(url), WINDOWS_TIMEOUT_MS);
    }
  };
}

/** Electron's own open, which on Linux resolves once `xdg-open` has started, without waiting for it (Electron 43.2.0's source, and probed 2026-11-13), so only a failure to start it is seen. */
const throughElectron: Open = (url) => shell.openExternal(url);

/** What went wrong opening `url`, or null once it was handed on; anything but an http(s) link is refused untried. */
export async function openLink(url: string, open: Open): Promise<string | null> {
  if (!WEB_LINK.test(url)) return 'only http and https links open';
  try {
    await open(url);
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** Open the links the window asks for, through Windows under WSL and through Electron elsewhere, telling the window about one that failed. */
export function registerLinkIpc(): void {
  const open = runsOnWsl(process.platform, process.env, readProcVersion) ? throughWindows() : throughElectron;
  ipcMain.on('shell:openExternal', (event, url: string) => {
    void openLink(url, open).then((problem) => {
      if (problem === null) return;
      log('warn', 'link', `could not open ${url}: ${problem}`);
      if (!event.sender.isDestroyed()) event.sender.send('shell:openFailed', url, problem);
    });
  });
}
