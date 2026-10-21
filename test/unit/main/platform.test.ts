import { describe, it, expect } from 'vitest';
import { runsOnWsl } from '../../../src/main/platform';

const WSL_KERNEL = 'Linux version 6.18.54.1-microsoft-standard-WSL2 (root@9b80f41eb17c) (gcc (GCC) 13.2.0, GNU ld (GNU Binutils) 2.41) #1 SMP PREEMPT_DYNAMIC';
const LINUX_KERNEL = 'Linux version 6.8.0-45-generic (buildd@lcy02-amd64-115) (x86_64-linux-gnu-gcc-13 (Ubuntu 13.2.0-23ubuntu4) 13.2.0) #45-Ubuntu SMP PREEMPT_DYNAMIC';
const kernel = (line: string | undefined) => () => line;

describe('runsOnWsl', () => {
  it('is WSL on Linux with either of WSL’s variables, whatever the kernel says', () => {
    expect(runsOnWsl('linux', { WSL_DISTRO_NAME: 'Ubuntu' }, kernel(LINUX_KERNEL))).toBe(true);
    expect(runsOnWsl('linux', { WSL_INTEROP: '/run/WSL/1_interop' }, kernel(undefined))).toBe(true);
  });

  it('is WSL on Linux without the variables when the kernel names Microsoft or WSL, in any case', () => {
    expect(runsOnWsl('linux', {}, kernel(WSL_KERNEL))).toBe(true);
    expect(runsOnWsl('linux', {}, kernel('Linux version 5.4.72-MICROSOFT-standard'))).toBe(true);
    expect(runsOnWsl('linux', {}, kernel('Linux version 4.4.0-wsl'))).toBe(true);
  });

  it('is native Linux without the variables and with a kernel that names neither, or none to read', () => {
    expect(runsOnWsl('linux', {}, kernel(LINUX_KERNEL))).toBe(false);
    expect(runsOnWsl('linux', {}, kernel(undefined))).toBe(false);
  });

  it('is never WSL off Linux, even with the variables set', () => {
    expect(runsOnWsl('darwin', { WSL_DISTRO_NAME: 'Ubuntu' }, kernel(WSL_KERNEL))).toBe(false);
    expect(runsOnWsl('win32', { WSL_INTEROP: '/run/WSL/1_interop' }, kernel(WSL_KERNEL))).toBe(false);
  });
});
