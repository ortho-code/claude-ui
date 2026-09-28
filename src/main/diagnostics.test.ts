import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { appHandlers, logged } = vi.hoisted(() => ({
  appHandlers: new Map<string, (...args: unknown[]) => void>(),
  /** Every log line as `level area message`, and every crash line as `crash area message`. */
  logged: [] as string[],
}));

vi.mock('electron', () => ({
  app: { on: (event: string, fn: (...args: unknown[]) => void) => appHandlers.set(event, fn) },
}));
vi.mock('./log', () => ({
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logCrash: (area: string, message: string) => logged.push(`crash ${area} ${message}`),
}));

import { describeInstall, logProcessFailures, logResponsiveness } from './diagnostics';
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

describe('logResponsiveness', () => {
  it('says when the window stopped answering and how long it took to come back', () => {
    vi.useFakeTimers();
    logged.length = 0;
    const handlers = new Map<string, () => void>();
    logResponsiveness({ on: (event: string, fn: () => void) => handlers.set(event, fn) } as unknown as BrowserWindow);
    handlers.get('unresponsive')!();
    vi.advanceTimersByTime(4200);
    handlers.get('responsive')!();
    vi.useRealTimers();
    expect(logged).toEqual(['warn renderer window stopped responding', 'info renderer window responding again after 4.2 s']);
  });
});
