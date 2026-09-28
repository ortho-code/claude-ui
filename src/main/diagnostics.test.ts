import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { appHandlers, ipcHandlers, logged } = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: unknown[]) => void>(),
  ipcHandlers: new Map<string, (...args: unknown[]) => void>(),
  /** Every log line as `level area message`, and every crash line as `crash area message`. */
  logged: [] as string[],
}));

vi.mock('electron', () => ({
  app: { on: (event: string, fn: (...args: unknown[]) => void) => appHandlers.set(event, fn) },
  ipcMain: { on: (channel: string, fn: (...args: unknown[]) => void) => ipcHandlers.set(channel, fn) },
}));
vi.mock('./log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logCrash: (area: string, message: string) => logged.push(`crash ${area} ${message}`),
}));

import { describeInstall, logProcessFailures, registerRendererLog, sourceLabel, watchWindow } from './diagnostics';
import { RENDERER_LINE_MAX } from '../shared/log';
import type { BrowserWindow } from 'electron';

const facts = { packaged: true, appImage: undefined, execPath: '/opt/Claude UI/claude-ui-app', packageType: null };

describe('describeInstall', () => {
  it('says source for a copy run with npm start, whatever else is set', () => {
    expect(describeInstall({ ...facts, packaged: false, appImage: '/home/me/claude-ui.AppImage', packageType: 'deb' })).toBe('source');
  });

  it('names the AppImage file being run', () => {
    expect(describeInstall({ ...facts, appImage: '/home/me/claude-ui.AppImage', execPath: '/tmp/.mount_claude/claude-ui-app' })).toBe(
      'AppImage /home/me/claude-ui.AppImage',
    );
  });

  it('reports a packaged copy by where it runs from, adding package-type only when the build has one', () => {
    expect(describeInstall({ ...facts, packageType: 'deb' })).toBe('packaged /opt/Claude UI/claude-ui-app, package-type deb');
    expect(describeInstall(facts)).toBe('packaged /opt/Claude UI/claude-ui-app');
    expect(describeInstall({ ...facts, execPath: '/Volumes/Claude UI/Claude UI.app/Contents/MacOS/Claude UI' })).toBe(
      'packaged /Volumes/Claude UI/Claude UI.app/Contents/MacOS/Claude UI',
    );
  });
});

describe('logProcessFailures', () => {
  let monitorsBefore: ReturnType<typeof process.listeners<'uncaughtExceptionMonitor'>>;

  beforeEach(() => {
    appHandlers.clear();
    logged.length = 0;
    monitorsBefore = process.listeners('uncaughtExceptionMonitor');
  });
  afterEach(() => {
    // The monitor is real and process-wide, so this file's must not outlive its test.
    for (const listener of process.listeners('uncaughtExceptionMonitor')) {
      if (!monitorsBefore.includes(listener)) process.removeListener('uncaughtExceptionMonitor', listener);
    }
  });

  // Electron shows its main-process error dialog only while it is the ONE uncaughtException listener. Adding a listener would take the dialog away in silence.
  it('leaves uncaughtException alone, so Electron still shows its dialog', () => {
    const before = process.listenerCount('uncaughtException');
    logProcessFailures();
    expect(process.listenerCount('uncaughtException')).toBe(before);
  });

  it('keeps an uncaught exception and an unhandled rejection as crashes, with the stack', () => {
    logProcessFailures();
    const error = new Error('boom');
    process.emit('uncaughtExceptionMonitor', error, 'uncaughtException');
    process.emit('uncaughtExceptionMonitor', 'just a string' as unknown as Error, 'unhandledRejection');
    expect(logged).toEqual([`crash main uncaught exception: ${error.stack}`, 'crash main unhandled rejection: just a string']);
  });

  it('keeps a renderer that died as a crash, and one that exited cleanly as a line', () => {
    logProcessFailures();
    appHandlers.get('render-process-gone')!({}, {}, { reason: 'crashed', exitCode: 139 });
    appHandlers.get('render-process-gone')!({}, {}, { reason: 'clean-exit', exitCode: 0 });
    expect(logged).toEqual(['crash renderer renderer gone: crashed, exit code 139', 'info renderer renderer gone: clean-exit, exit code 0']);
  });

  it('keeps the GPU process dying as a crash, and another child dying as an error', () => {
    logProcessFailures();
    appHandlers.get('child-process-gone')!({}, { type: 'GPU', reason: 'crashed', exitCode: 1 });
    appHandlers.get('child-process-gone')!({}, { type: 'Utility', reason: 'oom', exitCode: 2, name: 'Network Service' });
    appHandlers.get('child-process-gone')!({}, { type: 'Utility', reason: 'clean-exit', exitCode: 0, name: 'Audio Service' });
    expect(logged).toEqual([
      'crash gpu GPU process gone: crashed, exit code 1',
      'error process Utility process gone: oom, exit code 2 (Network Service)',
      'info process Utility process gone: clean-exit, exit code 0 (Audio Service)',
    ]);
  });
});

describe('watchWindow', () => {
  function watched(): { win: Map<string, (...args: unknown[]) => void>; contents: Map<string, (...args: unknown[]) => void> } {
    const win = new Map<string, (...args: unknown[]) => void>();
    const contents = new Map<string, (...args: unknown[]) => void>();
    watchWindow({
      on: (event: string, fn: (...args: unknown[]) => void) => win.set(event, fn),
      webContents: { on: (event: string, fn: (...args: unknown[]) => void) => contents.set(event, fn) },
    } as unknown as BrowserWindow);
    logged.length = 0;
    return { win, contents };
  }

  it('says when the window stopped answering and how long it took to come back', () => {
    vi.useFakeTimers();
    const { win } = watched();
    win.get('unresponsive')!();
    vi.advanceTimersByTime(4200);
    win.get('responsive')!();
    vi.useRealTimers();
    expect(logged).toEqual(['warn renderer window stopped responding', 'info renderer window responding again after 4.2 s']);
  });

  it('forwards the page’s warnings and errors with where they came from, and nothing quieter', () => {
    const { contents } = watched();
    const message = (level: string, text: string, sourceId = 'file:///opt/Claude%20UI/resources/app.asar/dist/renderer/renderer.js') =>
      contents.get('console-message')!({ level, message: text, sourceId, lineNumber: 12 });
    message('info', 'chatter');
    message('debug', 'more chatter');
    message('warning', 'deprecated thing');
    message('error', 'Uncaught (in promise) Error: boom');
    message('error', 'from a data URL', 'data:text/html,%3Cscript%3E');
    expect(logged).toEqual([
      'warn console deprecated thing (renderer.js:12)',
      'error console Uncaught (in promise) Error: boom (renderer.js:12)',
      'error console from a data URL',
    ]);
  });
});

describe('sourceLabel', () => {
  it('is the file’s name, or nothing for a source that is not a file', () => {
    expect(sourceLabel('file:///home/me/claude-ui/dist/renderer/renderer.js')).toBe('renderer.js');
    expect(sourceLabel('node:electron/js2c/sandbox_bundle')).toBe('sandbox_bundle');
    expect(sourceLabel(`data:text/html,${'%3C'.repeat(40)}`)).toBe('');
    expect(sourceLabel('')).toBe('');
  });
});

describe('registerRendererLog', () => {
  it('writes the window’s own lines, cutting one that runs long', () => {
    registerRendererLog();
    logged.length = 0;
    const write = ipcHandlers.get('log:write')!;
    write(null, 'info', 'xterm', 'terminals draw on canvas');
    write(null, 'warn', 'tab', 'x'.repeat(RENDERER_LINE_MAX + 50));
    expect(logged).toEqual(['info xterm terminals draw on canvas', `warn tab ${'x'.repeat(RENDERER_LINE_MAX)}`]);
  });

  it('refuses a level or an area it does not know, and a message that is not text', () => {
    registerRendererLog();
    logged.length = 0;
    const write = ipcHandlers.get('log:write')!;
    write(null, 'fatal', 'tab', 'made-up level');
    write(null, 'info', 'Tab With Spaces', 'bad area');
    write(null, 'info', 'app\n2026-09-28 ERROR fake', 'an area that forges a line');
    write(null, 'info', 'tab', { not: 'text' });
    expect(logged).toEqual([]);
  });
});
