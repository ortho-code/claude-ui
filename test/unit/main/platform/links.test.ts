import { describe, it, expect } from 'vitest';
import { openLink, throughWindows } from '../../../../src/main/platform/links';
import type { Run } from '../../../../src/main/platform/platform';

const LINK = 'https://github.com/ScientaNL/demo/pull/7';

/** A failure as `execFile` gives one: `ENOENT` for a program that is not there, an exit code for one that failed. */
const failed = (code: string | number): Error => Object.assign(new Error(`failed: ${code}`), { code });

/** A machine where `found` are the programs there, each call recorded with its arguments. */
function machine(found: readonly string[]): { run: Run; calls: [string, string[]][] } {
  const calls: [string, string[]][] = [];
  const run: Run = (file, args) => {
    calls.push([file, args]);
    return found.includes(file) ? Promise.resolve('') : Promise.reject(failed('ENOENT'));
  };
  return { run, calls };
}

describe('throughWindows', () => {
  it("hands the link to Windows' own handler for it", async () => {
    const { run, calls } = machine(['rundll32.exe']);
    await throughWindows(run)(LINK);
    expect(calls).toEqual([['rundll32.exe', ['url.dll,FileProtocolHandler', LINK]]]);
  });

  it("finds rundll32.exe in Windows' own folder when interop leaves Windows off the path", async () => {
    const fallback = '/mnt/c/Windows/System32/rundll32.exe';
    const { run, calls } = machine([fallback]);
    await throughWindows(run)(LINK);
    expect(calls.map(([file]) => file)).toEqual(['rundll32.exe', fallback]);
  });

  it('fails when Windows cannot be reached', async () => {
    const { run } = machine([]);
    await expect(throughWindows(run)(LINK)).rejects.toThrow('failed: ENOENT');
  });
});

describe('openLink', () => {
  it('opens an http or https link and reports nothing', async () => {
    const opened: string[] = [];
    expect(await openLink(LINK, (url) => Promise.resolve(void opened.push(url)))).toBeNull();
    expect(await openLink('http://localhost:8880/', (url) => Promise.resolve(void opened.push(url)))).toBeNull();
    expect(opened).toEqual([LINK, 'http://localhost:8880/']);
  });

  it('says what went wrong when the open fails', async () => {
    expect(await openLink(LINK, () => Promise.reject(failed(1)))).toBe('failed: 1');
  });

  it('refuses any other kind of link without trying it', async () => {
    const opened: string[] = [];
    expect(await openLink('file:///etc/passwd', (url) => Promise.resolve(void opened.push(url)))).toBe('only http and https links open');
    expect(opened).toEqual([]);
  });
});
