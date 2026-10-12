import { execFileSync } from 'node:child_process';
import { hookScriptPath } from '../../../src/main/paths';

/** The terminal token every run of the hook script reports, as `CLAUDE_UI_TAB`. */
export const TOKEN = 'tab-token-1';

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
