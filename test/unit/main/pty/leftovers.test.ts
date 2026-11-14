import { describe, it, expect, vi, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock('../../../../src/main/logs/log', () => ({
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { ownSession, runMark, sweepLeftovers, RUN_VARIABLE } from '../../../../src/main/pty/leftovers';

const started: number[] = [];

/** Start `script` with `env` on top of this process's, in a session of its own as the app starts what it runs, or with `detached` false in this process's, as main runs git. */
function start(script: string, env: Record<string, string>, detached = true): number {
  const child = spawn('/bin/sh', ['-c', script], { env: { ...process.env, ...env }, detached, stdio: 'ignore' });
  child.unref();
  started.push(child.pid!);
  return child.pid!;
}

/** Whether `pid` runs: there, and not a zombie waiting for its parent. */
function alive(pid: number): boolean {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
}

/** The pids in the session `session` leads. */
function inSession(session: number): number[] {
  const out: number[] = [];
  for (const name of readdirSync('/proc')) {
    const pid = Number(name);
    if (!Number.isInteger(pid)) continue;
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[3]) === session && alive(pid)) out.push(pid);
    } catch {
      // Gone.
    }
  }
  return out;
}

/** Wait until `check` holds, for at most two seconds. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
}

afterEach(() => {
  for (const pid of started.splice(0)) {
    for (const member of [pid, ...inSession(pid)]) {
      try {
        process.kill(member, 'SIGKILL');
      } catch {
        // Gone already.
      }
    }
  }
  logged.length = 0;
});

describe.runIf(process.platform === 'linux')('sweepLeftovers', () => {
  it('ends a process still in a session the app started', async () => {
    const pid = start('exec sleep 30', runMark());
    ownSession(pid);
    await until(() => alive(pid));
    await sweepLeftovers();
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
    expect(logged.some((line) => line.startsWith(`warn process pid ${pid} still running in a session the app started`))).toBe(true);
  });

  it("ends a child its session's leader left behind", async () => {
    const leader = start('sleep 30 & exit 0', runMark());
    ownSession(leader);
    await until(() => !alive(leader) && inSession(leader).length === 1);
    const [child] = inSession(leader);
    expect(child).toBeDefined();
    await sweepLeftovers();
    await until(() => !alive(child));
    expect(alive(child)).toBe(false);
  });

  it('kills one that ignores SIGTERM once the grace has passed', async () => {
    const pid = start("trap '' TERM; while :; do sleep 0.1; done", runMark());
    ownSession(pid);
    await until(() => alive(pid));
    await sweepLeftovers();
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
    expect(logged).toContain(`warn process pid ${pid} still running 1000 ms after SIGTERM, sending SIGKILL`);
  });

  it("ends one main ran in the app's own session, such as git", async () => {
    const pid = start('exec sleep 30', runMark(), false);
    await until(() => alive(pid));
    await sweepLeftovers();
    await until(() => !alive(pid));
    expect(alive(pid)).toBe(false);
  });

  it('logs one that left the sessions the app started, and leaves it running', async () => {
    const pid = start('exec sleep 30', runMark());
    await until(() => alive(pid));
    await sweepLeftovers();
    expect(alive(pid)).toBe(true);
    expect(logged).toContain(`info process pid ${pid} left the app's sessions and is still running, not ended: sleep 30`);
  });

  it("leaves alone a process carrying another run's id, such as a second instance's", async () => {
    const pid = start('exec sleep 30', { [RUN_VARIABLE]: 'another-run' });
    ownSession(pid);
    await until(() => alive(pid));
    await sweepLeftovers();
    expect(alive(pid)).toBe(true);
    expect(logged.filter((line) => line.includes(`pid ${pid} `))).toEqual([]);
  });
});
