import { describe, it, expect } from 'vitest';
import { copiedFiles, listsImage, printedPaths, type Run } from '../../../src/main/clipboard';

const POWERSHELL_FALLBACK = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';

/** A failure as `execFile` gives one: `ENOENT` for a program that is not there, an exit code for one that failed. */
const failed = (code: string | number): Error => Object.assign(new Error(`failed: ${code}`), { code });

/** Programs answered from `answers` by name, each call recorded; a program left out is not there. */
function machine(answers: Partial<Record<string, (args: string[]) => string>>): { run: Run; calls: string[] } {
  const calls: string[] = [];
  const run: Run = (file, args) => {
    calls.push(file);
    const answer = answers[file];
    if (!answer) return Promise.reject(failed('ENOENT'));
    try {
      return Promise.resolve(answer(args));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  };
  return { run, calls };
}

const wslpath = (args: string[]): string => `${args[1].replace(/^([A-Za-z]):/, (_, drive: string) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/')}\n`;

describe('listsImage', () => {
  it('finds an image among the types wl-paste lists', () => {
    expect(listsImage('image/bmp\n')).toBe(true);
    expect(listsImage('text/plain;charset=utf-8\nimage/png\n')).toBe(true);
  });

  it('finds none among text types, or in an empty list', () => {
    expect(listsImage('text/plain;charset=utf-8\nSTRING\n')).toBe(false);
    expect(listsImage('')).toBe(false);
  });
});

describe('printedPaths', () => {
  it('reads one path a line, with Windows line ends, and drops blank lines', () => {
    expect(printedPaths('C:\\a b\\x.png\r\nC:\\y.png\r\n\r\n')).toEqual(['C:\\a b\\x.png', 'C:\\y.png']);
    expect(printedPaths('')).toEqual([]);
  });
});

describe('copiedFiles', () => {
  it("maps each file Windows has copied to WSL's path for it", async () => {
    const { run } = machine({ 'wl-paste': () => '', 'powershell.exe': () => 'C:\\Users\\me\\My Pics\\a.png\r\nD:\\b.png\r\n', wslpath });
    expect(await copiedFiles(run)).toEqual(['/mnt/c/Users/me/My Pics/a.png', '/mnt/d/b.png']);
  });

  it('leaves an image on the clipboard to claude, and does not ask Windows', async () => {
    const { run, calls } = machine({ 'wl-paste': () => 'image/bmp\n', 'powershell.exe': () => 'C:\\a.png\r\n', wslpath });
    expect(await copiedFiles(run)).toEqual([]);
    expect(calls).toEqual(['wl-paste']);
  });

  it('asks nothing of Windows without wl-clipboard', async () => {
    const { run, calls } = machine({ 'powershell.exe': () => 'C:\\a.png\r\n', wslpath });
    expect(await copiedFiles(run)).toEqual([]);
    expect(calls).toEqual(['wl-paste']);
  });

  it('asks Windows when wl-paste fails for any reason but not being there', async () => {
    const { run } = machine({
      'wl-paste': () => {
        throw failed(1);
      },
      'powershell.exe': () => 'C:\\a.png\r\n',
      wslpath,
    });
    expect(await copiedFiles(run)).toEqual(['/mnt/c/a.png']);
  });

  it('finds none where Windows has no files copied', async () => {
    const { run } = machine({ 'wl-paste': () => '', 'powershell.exe': () => '', wslpath });
    expect(await copiedFiles(run)).toEqual([]);
  });

  it('looks for powershell.exe where Windows keeps it when it is not on PATH', async () => {
    const { run, calls } = machine({ 'wl-paste': () => '', [POWERSHELL_FALLBACK]: () => 'C:\\a.png\r\n', wslpath });
    expect(await copiedFiles(run)).toEqual(['/mnt/c/a.png']);
    expect(calls).toEqual(['wl-paste', 'powershell.exe', POWERSHELL_FALLBACK, 'wslpath']);
  });

  it('finds none when Windows does not answer', async () => {
    const { run } = machine({
      'wl-paste': () => '',
      'powershell.exe': () => {
        throw failed('ETIMEDOUT');
      },
      wslpath,
    });
    expect(await copiedFiles(run)).toEqual([]);
  });

  it('leaves out a path WSL cannot map, and keeps the rest', async () => {
    const { run } = machine({
      'wl-paste': () => '',
      'powershell.exe': () => '\\\\server\\share\\a.png\r\nC:\\b.png\r\n',
      wslpath: (args) => {
        if (args[1].startsWith('\\\\')) throw failed(1);
        return wslpath(args);
      },
    });
    expect(await copiedFiles(run)).toEqual(['/mnt/c/b.png']);
  });
});
