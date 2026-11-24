import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock('../../../../src/main/logs/log', async (original) => ({
  ...(await original<typeof import('../../../../src/main/logs/log')>()),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));
vi.mock('../../../../src/main/status/hooks', () => ({ SCOPE_ENV: 'CLAUDE_UI' }));

import { runningElsewhere } from '../../../../src/main/pty/running-elsewhere';

const ID = '8cee36b4-1111-4222-8333-444455556666';
const OTHER_ID = '2fdf38d3-1111-4222-8333-444455556666';
const NAMESPACE = 'pid:[4026532215]';

let root: string;
let registry: string;
let proc: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'running-elsewhere-'));
  registry = join(root, 'sessions');
  proc = join(root, 'proc');
  mkdirSync(registry);
  mkdirSync(join(proc, 'self', 'ns'), { recursive: true });
  symlinkSync(NAMESPACE, join(proc, 'self', 'ns', 'pid'));
  logged.length = 0;
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A process under the fake `/proc`, its command holding a space and a parenthesis as a real one may, started at `start`. */
function processAt(pid: number, start: string, environ: string[] = []): void {
  mkdirSync(join(proc, String(pid)));
  const fields = Array.from({ length: 50 }, (_, i) => String(i));
  fields[19] = start;
  writeFileSync(join(proc, String(pid), 'stat'), `${pid} (cl (au) de) ${fields.join(' ')}\n`);
  writeFileSync(join(proc, String(pid), 'environ'), [...environ, ''].join('\0'));
}

/** Claude Code's record of a claude under `pid`, with the fields it writes, overridden by `fields`. */
function entry(pid: number, fields: Record<string, unknown> = {}): void {
  const written = { pid, sessionId: ID, cwd: '/work/scienta', startedAt: 1795440946000, procStart: '9000', kind: 'interactive', entrypoint: 'cli', pidDomain: `linux:abc:${NAMESPACE}`, ...fields };
  writeFileSync(join(registry, `${pid}.json`), JSON.stringify(written));
}

describe('runningElsewhere', () => {
  it('names the claude that runs the session, from the record of a process that still runs', async () => {
    processAt(4100, '9000');
    entry(4100);

    expect(await runningElsewhere(ID, registry, proc)).toEqual({ where: 'terminal', cwd: '/work/scienta', since: 1795440946000 });
  });

  it('finds nothing for a session no running claude holds, while another session runs', async () => {
    processAt(4100, '9000');
    entry(4100, { sessionId: OTHER_ID });

    expect(await runningElsewhere(OTHER_ID, registry, proc)).not.toBeNull();
    expect(await runningElsewhere(ID, registry, proc)).toBeNull();
  });

  it('skips a record left behind whose pid another process now uses', async () => {
    processAt(4100, '9500');
    entry(4100);

    expect(await runningElsewhere(ID, registry, proc)).toBeNull();
  });

  it('skips a record whose process is gone', async () => {
    entry(4100);

    expect(await runningElsewhere(ID, registry, proc)).toBeNull();
  });

  it('skips a record from another pid namespace, and counts one that names none', async () => {
    processAt(4100, '9000');
    entry(4100, { pidDomain: 'linux:abc:pid:[4026532214]' });
    expect(await runningElsewhere(ID, registry, proc)).toBeNull();

    entry(4100, { pidDomain: undefined });
    expect(await runningElsewhere(ID, registry, proc)).not.toBeNull();
  });

  it.each([
    ['claude-ui', ['CLAUDE_UI=1'], 'cli'],
    ['desktop', [], 'claude-desktop'],
    ['script', [], 'sdk-cli'],
    ['terminal', ['CLAUDE_UI_RUN=x'], 'cli'],
  ])('says it runs in %s', async (where, environ, entrypoint) => {
    processAt(4100, '9000', environ);
    entry(4100, { entrypoint });

    expect((await runningElsewhere(ID, registry, proc))?.where).toBe(where);
  });

  it('reads past a record that does not parse or lacks a field', async () => {
    processAt(4100, '9000');
    writeFileSync(join(registry, '4100.json'), '{"pid":41');
    processAt(4200, '9000');
    entry(4200, { cwd: undefined });
    processAt(4300, '9000');
    entry(4300, { cwd: '/work/other' });

    expect((await runningElsewhere(ID, registry, proc))?.cwd).toBe('/work/other');
  });

  it('finds nothing, and logs nothing, where Claude Code keeps no record', async () => {
    rmSync(registry, { recursive: true });

    expect(await runningElsewhere(ID, registry, proc)).toBeNull();
    expect(logged).toEqual([]);
  });
});
