import { readFileSync } from 'node:fs';

/**
 * Whether claude, started by the app, counts itself as running under WSL: on Linux, with WSL's variables set or a kernel that names Microsoft or WSL.
 * Claude's own rule, read from its platform check (claude 2.1.302), and not a looser one, because what the window does with the answer leans on claude's: Ctrl+V pastes only where claude takes an empty paste as an image paste, which on Linux is under WSL alone (docs/architecture.md § The `terminal` type).
 * A session inherits the app's environment, so the two look at the same variables.
 */
export function runsOnWsl(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, procVersion: () => string | undefined): boolean {
  if (platform !== 'linux') return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  const kernel = procVersion()?.toLowerCase();
  return kernel !== undefined && (kernel.includes('microsoft') || kernel.includes('wsl'));
}

/** The kernel's version line, or nothing where it cannot be read. */
export function readProcVersion(): string | undefined {
  try {
    return readFileSync('/proc/version', 'utf8');
  } catch {
    return undefined;
  }
}
