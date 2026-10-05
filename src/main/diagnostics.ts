import { app, ipcMain, type BrowserWindow } from 'electron';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { log, logCrash } from './log';
import { formatDuration } from './stamp';
import { LOG_LEVELS, RENDERER_LINE_MAX, type LogLevel } from '../shared/log';

export interface InstallFacts {
  packaged: boolean;
  /** `APPIMAGE`, which the AppImage runtime sets to the file being run. */
  appImage: string | undefined;
  execPath: string;
  /** electron-builder's `resources/package-type`, when the build has one. */
  packageType: string | null;
}

/**
 * How this copy was installed, as what can be SEEN rather than a label guessed from it.
 * A `.deb` has no mark of its own that the project chose: electron-builder writes `package-type` only as a side effect of the auto-update settings it infers, which this project does not use, so it is reported when present and never relied on.
 * The executable's path says the rest to anyone reading — `/opt/Claude UI/` is where the `.deb` puts it, and a Mac bundle run from `/Volumes/` is still inside its disk image.
 */
export function describeInstall({ packaged, appImage, execPath, packageType }: InstallFacts): string {
  if (!packaged) return 'source';
  if (appImage) return `AppImage ${appImage}`;
  return `packaged ${execPath}${packageType ? `, package-type ${packageType}` : ''}`;
}

function readPackageType(): string | null {
  try {
    return readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/** The lines every log file opens with: which build, installed how, on what machine, drawn how. */
export function headerLines(launched: string): string[] {
  const install = describeInstall({
    packaged: app.isPackaged,
    appImage: process.env.APPIMAGE,
    execPath: process.execPath,
    packageType: readPackageType(),
  });
  const system = [`${os.type()} ${os.release()}`];
  if (process.platform === 'darwin') system.push(`macOS ${process.getSystemVersion()}`);
  if (process.env.WSL_DISTRO_NAME) system.push(`WSL ${process.env.WSL_DISTRO_NAME}`);
  const lines = [
    `claude-ui ${app.getVersion()} on ${process.platform} ${process.arch}, pid ${process.pid}, launched ${launched}`,
    `install ${install}`,
    `os ${system.join(', ')}`,
    `electron ${process.versions.electron}, chromium ${process.versions.chrome}, node ${process.versions.node}`,
  ];
  // Which display the window can reach is the first question about a blank or white one on Linux.
  if (process.platform === 'linux') {
    const env = (name: string): string => `${name}=${process.env[name] ?? '-'}`;
    lines.push(`display ${['XDG_SESSION_TYPE', 'DISPLAY', 'WAYLAND_DISPLAY'].map(env).join(' ')}`);
  }
  return lines;
}

/**
 * The GPU's feature status, logged each time it changes.
 * Only meaningful once `gpu-info-update` has fired, so it is a line of its own rather than part of the header; a change later in a run is a fallback worth seeing.
 */
export function logGpuStatus(): void {
  let logged = '';
  app.on('gpu-info-update', () => {
    const status = Object.entries(app.getGPUFeatureStatus())
      .map(([feature, state]) => `${feature}=${String(state)}`)
      .join(' ');
    if (status === logged) return;
    logged = status;
    log('info', 'gpu', status);
  });
}

/**
 * Everything that ends a process of the app, logged without changing what happens next.
 *
 * `uncaughtExceptionMonitor`, never `uncaughtException`: Electron shows its "A JavaScript error occurred in the main process" dialog only while nobody else listens for the latter (`lib/browser/init.ts`), so a listener here would silently take that dialog away.
 * The monitor sees the error first and does not count as a listener.
 * MEASURED on Electron's own Node: it also sees an unhandled rejection, which Node raises as an uncaught exception, with `origin` saying which it was.
 * Both are kept as crash logs — they reach the user as the same dialog, and Node treats them as the same thing.
 * A renderer or child process that exits cleanly is a line, not a crash; the GPU process dying is one, since it is the first suspect for a window that paints blank.
 */
export function logProcessFailures(): void {
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    // Typed as an Error, but a rejection can carry any value at all.
    const reason: unknown = error;
    const what = origin === 'unhandledRejection' ? 'unhandled rejection' : 'uncaught exception';
    logCrash('main', `${what}: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  });
  app.on('render-process-gone', (_event, _contents, details) => {
    const line = `renderer gone: ${details.reason}, exit code ${details.exitCode}`;
    if (details.reason === 'clean-exit') log('info', 'renderer', line);
    else logCrash('renderer', line);
  });
  app.on('child-process-gone', (_event, details) => {
    const line = `${details.type} process gone: ${details.reason}, exit code ${details.exitCode}${details.name ? ` (${details.name})` : ''}`;
    if (details.reason === 'clean-exit') log('info', 'process', line);
    else if (details.type === 'GPU') logCrash('gpu', line);
    else log('error', 'process', line);
  });
}

/**
 * Where a console message came from, short enough for a line: the file's name from its URL (`renderer.js`), or nothing for a source that is not one — a `data:` URL is the whole page.
 */
export function sourceLabel(sourceId: string): string {
  if (sourceId.startsWith('data:')) return '';
  const name = sourceId.split('/').pop() ?? '';
  return name.length > 0 && name.length <= 60 ? name : '';
}

/**
 * What the window does that the log should hear about: its page's warnings and errors, and its stopping answering.
 *
 * MEASURED on Electron 43 with a hidden window: an uncaught error in the page and an unhandled rejection both arrive here, as `error` lines reading `Uncaught …` and `Uncaught (in promise) …`, so this one listener is the renderer's crash reporting as well as its console.
 * The renderer itself writes nothing to the console on purpose; what arrives is Chromium's and the page's failures, so `info` and `debug` are left out.
 */
export function watchWindow(win: BrowserWindow): void {
  win.webContents.on('console-message', ({ level, message, sourceId, lineNumber }) => {
    if (level !== 'warning' && level !== 'error') return;
    const source = sourceLabel(sourceId);
    log(level === 'error' ? 'error' : 'warn', 'console', `${message}${source ? ` (${source}:${lineNumber})` : ''}`);
  });
  let since: number | null = null;
  win.on('unresponsive', () => {
    since = Date.now();
    log('warn', 'renderer', 'window stopped responding');
  });
  win.on('responsive', () => {
    log('info', 'renderer', `window responding again${since === null ? '' : ` after ${formatDuration(Date.now() - since)}`}`);
    since = null;
  });
}

/**
 * The window's own lines, from the preload `log()`: checked here rather than trusted, since the window is the less trusted side.
 * A level must be one of the log's, an area a short lowercase word, and a line is cut at RENDERER_LINE_MAX.
 */
export function registerRendererLog(): void {
  ipcMain.on('log:write', (_event, level: unknown, area: unknown, message: unknown) => {
    if (!LOG_LEVELS.includes(level as LogLevel) || typeof area !== 'string' || !/^[a-z][a-z-]{0,19}$/.test(area) || typeof message !== 'string') return;
    log(level as LogLevel, area, message.slice(0, RENDERER_LINE_MAX));
  });
}
