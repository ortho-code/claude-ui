import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { errorText, log } from './log';

/**
 * The files copied in Windows, for a paste under WSL that brought no text (docs/architecture.md § The `terminal` type).
 *
 * A file copied in Explorer reaches neither side of Linux's clipboard: Windows holds it as a file list, wl-paste lists nothing and X11 offers an empty text (probed 2026-10-21), so only powershell.exe can read it.
 * From Linux a screenshot looks the same, an empty paste, so wl-paste is asked first: an image it lists is left to claude, which reads a png, jpeg, gif, webp or bmp one from Linux without asking Windows, and asking Windows then would only put a powershell.exe call in front of it.
 * Without wl-clipboard there is no such cheap look, so nothing is asked and the paste goes on as it came.
 */

const execFileAsync = promisify(execFile);

/** How long wl-paste or wslpath may take; they took 24 ms and 6 ms when measured. */
const LINUX_TIMEOUT_MS = 5_000;

/** How long Windows may take to answer: warm runs took under a second, and a cold powershell.exe took ten seconds once (2026-10-20). */
const WINDOWS_TIMEOUT_MS = 15_000;

/** Where powershell.exe is when WSL's interop leaves Windows off `PATH`, as claude looks for it too. */
const POWERSHELL_FALLBACK = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

/** The copied files' Windows paths, one per line, asked for in UTF-8, for a name outside the console's code page. */
const FILE_LIST = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; (Get-Clipboard -Format FileDropList).FullName';

/** Runs a program and hands back what it printed; rejects as `execFile` does, with `code` 'ENOENT' for a program that is not there. */
export type Run = (file: string, args: string[], timeout: number) => Promise<string>;

const run: Run = async (file, args, timeout) => (await execFileAsync(file, args, { timeout, encoding: 'utf8' })).stdout;

const missing = (error: unknown): boolean => (error as { code?: unknown }).code === 'ENOENT';

/** Whether the types wl-paste lists, one per line, include an image. */
export function listsImage(types: string): boolean {
  return types.split('\n').some((type) => type.trim().startsWith('image/'));
}

/** The lines a program printed, one path each, with Windows' line ends and blank lines dropped. */
export function printedPaths(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** What wl-paste lists, or null without wl-clipboard; any other failure of it counts as listing nothing. */
async function waylandTypes(runner: Run): Promise<string | null> {
  try {
    return await runner('wl-paste', ['--list-types'], LINUX_TIMEOUT_MS);
  } catch (error) {
    return missing(error) ? null : '';
  }
}

async function windowsFileList(runner: Run): Promise<string> {
  const args = ['-NoProfile', '-NonInteractive', '-Command', FILE_LIST];
  try {
    return await runner('powershell.exe', args, WINDOWS_TIMEOUT_MS);
  } catch (error) {
    if (!missing(error)) throw error;
    return await runner(POWERSHELL_FALLBACK, args, WINDOWS_TIMEOUT_MS);
  }
}

/**
 * The files copied in Windows, as Linux paths: none where the clipboard holds an image, where nothing was copied, without wl-clipboard, and where Windows cannot be asked.
 * Each path is WSL's own mapping of it (`wslpath -u`), and one it cannot map, such as a plain UNC share or a drive WSL has not mounted, is left out.
 * A failure to ask is logged and answers none, so the paste goes on as it came.
 */
export async function copiedFiles(runner: Run = run): Promise<string[]> {
  const types = await waylandTypes(runner);
  if (types === null || listsImage(types)) return [];
  let windowsPaths: string[];
  try {
    windowsPaths = printedPaths(await windowsFileList(runner));
  } catch (error) {
    log('warn', 'clipboard', `could not ask Windows what was copied: ${errorText(error)}`);
    return [];
  }
  const linuxPaths: string[] = [];
  for (const windowsPath of windowsPaths) {
    try {
      const [mapped] = printedPaths(await runner('wslpath', ['-u', windowsPath], LINUX_TIMEOUT_MS));
      if (mapped) linuxPaths.push(mapped);
    } catch (error) {
      log('warn', 'clipboard', `could not map ${windowsPath} to a Linux path: ${errorText(error)}`);
    }
  }
  return linuxPaths;
}
