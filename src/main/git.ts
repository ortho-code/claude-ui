import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { markedEnv } from './pty/leftovers';

/**
 * Git, run read-only for what the window shows of a folder.
 *
 * `--no-optional-locks` keeps every call from refreshing the index, which `git status` otherwise writes after a change, holding its lock meanwhile, which `man git-status` warns may make other git processes running then fail.
 * `status.showStash` is switched off whatever the person's config says, since its line is the whole repository's, and git's messages are asked for in English, since which refusal is which is read from them.
 */

const execFileAsync = promisify(execFile);

/** How long one git call may take; a look that cannot answer in this says nothing either way. */
const GIT_TIMEOUT_MS = 10_000;

/**
 * Git in `dir`, with no optional locks, as raw bytes: a path git prints is the file system's bytes, which need not be UTF-8.
 * `maxBytes` is the most the call may print; past it the call fails rather than hold more.
 */
export async function git(dir: string, args: string[], maxBytes: number): Promise<Buffer> {
  const { stdout } = await execFileAsync('git', ['--no-optional-locks', '-c', 'status.showStash=false', '-C', dir, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: maxBytes,
    encoding: 'buffer',
    env: { ...markedEnv(), LC_ALL: 'C' },
  });
  return stdout;
}

/** What a failed git call said, on stderr where git says it. */
export function failure(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString('utf8').trim();
  return stderr || (error instanceof Error ? error.message : String(error));
}
