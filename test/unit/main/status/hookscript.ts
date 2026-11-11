import { beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { hookScriptPath, statusDir } from '../../../../src/main/paths';
import { installStatusHooks } from '../../../../src/main/status/hooks';

/** The terminal token every run of the hook script reports, as `CLAUDE_UI_TAB`. */
export const TOKEN = 'tab-token-1';

/** The session every run of the hook script reports on. */
export const SID = '0a945f9c-209b-4758-bf8e-30474af5826c';

/** The status file the hook script writes for `SID`. */
export const statusFile = path.join(statusDir, `${SID}.json`);

/**
 * Run the hook script as Claude Code would: the status as its argument, the event's JSON on stdin, `CLAUDE_UI` set.
 * `scoped` false drops CLAUDE_UI, standing in for a session started in a plain terminal.
 * The test that calls it mocks Electron, so that `hookScriptPath` is under its own temporary home.
 */
export function runHook(status: string, payload: Record<string, unknown>, scoped = true): void {
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: process.env.PATH, CLAUDE_UI_TAB: TOKEN };
  delete env.CLAUDE_UI;
  if (scoped) env.CLAUDE_UI = '1';
  try {
    execFileSync('bash', [hookScriptPath, status], { input: JSON.stringify(payload), env });
  } catch (error) {
    // Unscoped, the script's first line exits before anything reads stdin, so the payload can meet a pipe it already closed: the script doing its job, so that and only that is let through.
    if (scoped || (error as NodeJS.ErrnoException).code !== 'EPIPE') throw error;
  }
}

interface StatusFile {
  status?: string;
  tab?: string;
  event?: string;
  background?: string[];
}

/** What the hook script last wrote for `SID`, or null when there is no status file. */
export async function readStatusFile(): Promise<StatusFile | null> {
  try {
    return JSON.parse(await fs.readFile(statusFile, 'utf8')) as StatusFile;
  } catch {
    return null;
  }
}

/** The hook script installed before each test, and `SID` with no status, model or start yet. */
export function useHookScript(): void {
  beforeEach(async () => {
    await installStatusHooks();
    await fs.rm(statusFile, { force: true });
    await fs.rm(path.join(statusDir, `${SID}.model`), { force: true });
    await fs.rm(path.join(statusDir, `${SID}.start`), { force: true });
  });
}
