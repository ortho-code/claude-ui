import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));

vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} } }));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { PrStatuses, answeredNodes, failureOf, prQueryArgs, runGh, statusOf, type GhRun, type RunGh } from '../../../src/main/prstatus';
import { KILL_GRACE_MS } from '../../../src/main/shell';
import type { PrRef } from '../../../src/shared/types';

/** The fields `FULL_FIELDS` asks, as GitHub gave them for #36274 on 2026-10-21. */
const OPEN_NODE = {
  state: 'OPEN',
  isDraft: false,
  reviewDecision: 'REVIEW_REQUIRED',
  mergeable: 'MERGEABLE',
  commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
};

/** What `gh` printed on 2026-10-21, exiting 1, asked in this module's form about #36274 and a PR number that does not exist; `locations` left out of the error. */
const PARTLY_FOUND = JSON.stringify({
  data: { r0: { p36274: OPEN_NODE, p999999: null } },
  errors: [{ type: 'NOT_FOUND', path: ['r0', 'p999999'], message: 'Could not resolve to a PullRequest with the number of 999999.' }],
});

const pr = (number: number, repository = 'acme/app'): PrRef => ({ repository, number });

describe('prQueryArgs', () => {
  it('asks each PR under its repository, the owner and name as variables', () => {
    expect(prQueryArgs([pr(1), pr(7, 'acme/lib'), pr(2)], 'state')).toEqual([
      '-f',
      'query=query($o0:String!,$n0:String!,$o1:String!,$n1:String!){r0:repository(owner:$o0,name:$n0){p1:pullRequest(number:1){state} p2:pullRequest(number:2){state}} r1:repository(owner:$o1,name:$n1){p7:pullRequest(number:7){state}}}',
      '-f',
      'o0=acme',
      '-f',
      'n0=app',
      '-f',
      'o1=acme',
      '-f',
      'n1=lib',
    ]);
  });

  it('leaves out a repository that is not owner/name', () => {
    expect(prQueryArgs([pr(1, 'nobody'), pr(2, 'a/b/c'), pr(3)], 'state')[1]).toBe('query=query($o0:String!,$n0:String!){r0:repository(owner:$o0,name:$n0){p3:pullRequest(number:3){state}}}');
  });
});

describe('answeredNodes', () => {
  it('reads what GitHub found when it did not find everything', () => {
    const nodes = answeredNodes(PARTLY_FOUND, [pr(36274, 'ScientaNL/scienta'), pr(999999, 'ScientaNL/scienta')]);
    expect(nodes).toEqual(
      new Map([
        ['ScientaNL/scienta#36274', OPEN_NODE],
        ['ScientaNL/scienta#999999', null],
      ]),
    );
  });

  // A repository GitHub does not find is null where its field would be, as it answered for one that day.
  it('reads every PR of a repository GitHub did not find as not found', () => {
    const answer = JSON.stringify({ data: { r0: { p1: { state: 'MERGED' } }, r1: null } });
    expect(answeredNodes(answer, [pr(1), pr(5, 'acme/gone')])).toEqual(
      new Map([
        ['acme/app#1', { state: 'MERGED' }],
        ['acme/gone#5', null],
      ]),
    );
  });

  it('is null for an answer that is not JSON, or has no data', () => {
    expect(answeredNodes('', [pr(1)])).toBeNull();
    expect(answeredNodes('<html>502</html>', [pr(1)])).toBeNull();
    expect(answeredNodes(JSON.stringify({ message: 'Bad credentials', status: '401' }), [pr(1)])).toBeNull();
  });
});

describe('statusOf', () => {
  it('reads an open PR', () => {
    expect(statusOf(OPEN_NODE)).toEqual({ state: 'open', draft: false, review: 'review-required', checks: 'passed', conflict: false });
  });

  it('reads each of GitHub’s words for the checks, the review and a conflict', () => {
    const checks = (state: string) => statusOf({ ...OPEN_NODE, commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } });
    expect(checks('FAILURE')).toMatchObject({ checks: 'failed' });
    expect(checks('ERROR')).toMatchObject({ checks: 'failed' });
    expect(checks('PENDING')).toMatchObject({ checks: 'running' });
    expect(checks('EXPECTED')).toMatchObject({ checks: 'running' });
    expect(statusOf({ ...OPEN_NODE, reviewDecision: 'APPROVED' })).toMatchObject({ review: 'approved' });
    expect(statusOf({ ...OPEN_NODE, reviewDecision: 'CHANGES_REQUESTED' })).toMatchObject({ review: 'changes-requested' });
    expect(statusOf({ ...OPEN_NODE, mergeable: 'CONFLICTING' })).toMatchObject({ conflict: true });
    expect(statusOf({ ...OPEN_NODE, isDraft: true })).toMatchObject({ draft: true });
  });

  it('reads what GitHub leaves out or does not know as null', () => {
    expect(statusOf({ ...OPEN_NODE, reviewDecision: null, mergeable: 'UNKNOWN', commits: { nodes: [{ commit: { statusCheckRollup: null } }] } })).toEqual({
      state: 'open',
      draft: false,
      review: null,
      checks: null,
      conflict: null,
    });
    expect(statusOf({ ...OPEN_NODE, commits: { nodes: [] } })).toMatchObject({ checks: null });
    expect(statusOf({ ...OPEN_NODE, reviewDecision: 'constructor' })).toMatchObject({ review: null });
  });

  it('carries the state alone for a PR merged or closed', () => {
    expect(statusOf({ ...OPEN_NODE, state: 'MERGED' })).toEqual({ state: 'merged' });
    expect(statusOf({ ...OPEN_NODE, state: 'CLOSED' })).toEqual({ state: 'closed' });
  });

  it('is null for a PR GitHub did not find, or a state it does not name', () => {
    expect(statusOf(null)).toBeNull();
    expect(statusOf({ state: 'DRAFT' })).toBeNull();
  });
});

describe('failureOf', () => {
  const run = (code: number | null, stderr = ''): GhRun => ({ code, stdout: '', stderr });

  it('names a missing gh and a missing login', () => {
    expect(failureOf(run(127, 'claude-ui-gh: exec: gh: not found\n'))).toBe('gh was not found');
    expect(failureOf(run(4, 'To get started with GitHub CLI, please run:  gh auth login\n'))).toBe('gh is not logged in; run gh auth login');
  });

  it('says what gh said last, otherwise how it ended', () => {
    expect(failureOf(run(1, 'gh: Bad credentials (HTTP 401)\n'))).toBe('Bad credentials (HTTP 401)');
    expect(failureOf(run(1))).toBe('gh ended with exit code 1');
    expect(failureOf(run(null))).toBe('gh ended without an exit code');
  });

  it('says a call it stopped took too long, whatever it had printed', () => {
    expect(failureOf({ ...run(null, 'gh: still going\n'), stopped: true })).toBe('gh did not answer in 30 s');
  });
});

// A stand-in login shell and `gh`: the shell says something on its own stderr, as bash's job-control lines, then runs the script it is given as bash would, with `gh` found on PATH.
describe('runGh', () => {
  const dir = mkdtempSync(join(tmpdir(), 'claude-ui-gh-'));
  const saved = { SHELL: process.env.SHELL, PATH: process.env.PATH };
  writeFileSync(join(dir, 'shell'), '#!/bin/bash\necho "shell noise" >&2\nshift 3\nscript=$1\nshift\nexec /bin/bash -c "$script" "$@"\n', { mode: 0o755 });
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\nif [ "$GH_MODE" = hang ]; then echo $$ > "${dir}/pid"; trap '' TERM; sleep 20; fi\necho '{"data":{}}'\necho 'gh: oops' >&2\nexit 1\n`,
    { mode: 0o755 },
  );

  beforeEach(() => {
    process.env.SHELL = join(dir, 'shell');
    process.env.PATH = `${dir}:${saved.PATH}`;
    delete process.env.GH_MODE;
  });
  afterAll(() => {
    process.env.SHELL = saved.SHELL;
    process.env.PATH = saved.PATH;
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs gh api graphql with the arguments as given, its stderr apart from the shell’s', async () => {
    expect(await runGh(['-f', 'query=query{ x }', '-f', 'o0=it’s $HOME'])).toEqual({ code: 1, stdout: '{"data":{}}\n', stderr: 'gh: oops\n' });
    expect(readFileSync(join(dir, 'args'), 'utf8')).toBe('api\ngraphql\n-f\nquery=query{ x }\n-f\no0=it’s $HOME\n');
  });

  it('answers as stopped once the time is up, and kills a gh that ignores SIGTERM', { timeout: 15_000 }, async () => {
    process.env.GH_MODE = 'hang';
    expect(await runGh([], 300)).toEqual({ code: null, stdout: '', stderr: '', stopped: true });
    const pid = Number(readFileSync(join(dir, 'pid'), 'utf8'));
    await new Promise((resolve) => setTimeout(resolve, KILL_GRACE_MS + 500));
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

/**
 * A stand-in `gh` over a GitHub of `nodes`, every field of each PR by reference, answering as GitHub does: every field where a query asks them, the state alone where it asks that, null for a PR it has not.
 * It keeps what each request asked, and answers `failure` instead while one is set.
 */
function fakeGh(nodes: Record<string, unknown>) {
  const asks: { full: boolean; refs: string[] }[] = [];
  const state = { failure: null as GhRun | null };
  const gh: RunGh = (args) => {
    const query = args[1].slice('query='.length);
    const variables = new Map<string, string>();
    for (let at = 2; at < args.length; at += 2) {
      const [name, ...value] = args[at + 1].split('=');
      variables.set(name, value.join('='));
    }
    const full = query.includes('reviewDecision');
    const blocks = query.split(/ ?r(\d+):repository\(/).slice(1);
    const data: Record<string, Record<string, unknown>> = {};
    const refs: string[] = [];
    for (let at = 0; at < blocks.length; at += 2) {
      const index = blocks[at];
      const repository = `${variables.get(`o${index}`)}/${variables.get(`n${index}`)}`;
      data[`r${index}`] = {};
      for (const [, number] of blocks[at + 1].matchAll(/p(\d+):pullRequest/g)) {
        const ref = `${repository}#${number}`;
        refs.push(ref);
        const node = nodes[ref] as Record<string, unknown> | undefined;
        data[`r${index}`][`p${number}`] = node === undefined ? null : full ? node : { state: node.state };
      }
    }
    asks.push({ full, refs });
    return Promise.resolve(state.failure ?? { code: 0, stdout: JSON.stringify({ data }), stderr: '' });
  };
  return { gh, asks, state };
}

describe('PrStatuses', () => {
  beforeEach(() => {
    logged.length = 0;
  });

  const merged = { ...OPEN_NODE, state: 'MERGED' };
  const closed = { ...OPEN_NODE, state: 'CLOSED' };

  it('asks every PR its state first, then the open ones every field', async () => {
    const { gh, asks } = fakeGh({ 'acme/app#1': merged, 'acme/app#2': OPEN_NODE, 'acme/app#3': closed });
    const read = await new PrStatuses(gh).ask([pr(1), pr(2), pr(3)]);
    expect(asks).toEqual([
      { full: false, refs: ['acme/app#1', 'acme/app#2', 'acme/app#3'] },
      { full: true, refs: ['acme/app#2'] },
    ]);
    expect(read).toEqual({
      statuses: {
        'acme/app#1': { state: 'merged' },
        'acme/app#2': { state: 'open', draft: false, review: 'review-required', checks: 'passed', conflict: false },
        'acme/app#3': { state: 'closed' },
      },
      problem: null,
    });
  });

  it('asks again only what is not merged: an open PR every field, a closed one its state', async () => {
    const { gh, asks } = fakeGh({ 'acme/app#1': merged, 'acme/app#2': OPEN_NODE, 'acme/app#3': closed });
    const statuses = new PrStatuses(gh);
    await statuses.ask([pr(1), pr(2), pr(3)]);
    asks.length = 0;
    const read = await statuses.ask([pr(1), pr(2), pr(3)]);
    expect(asks).toEqual([
      { full: true, refs: ['acme/app#2'] },
      { full: false, refs: ['acme/app#3'] },
    ]);
    expect(Object.keys(read.statuses)).toEqual(['acme/app#1', 'acme/app#2', 'acme/app#3']);
  });

  it('follows a PR that changed since: open to merged, closed to open again', async () => {
    const github = { 'acme/app#2': OPEN_NODE, 'acme/app#3': closed } as Record<string, unknown>;
    const { gh, asks } = fakeGh(github);
    const statuses = new PrStatuses(gh);
    await statuses.ask([pr(2), pr(3)]);
    github['acme/app#2'] = merged;
    github['acme/app#3'] = { ...OPEN_NODE, reviewDecision: 'APPROVED' };
    asks.length = 0;
    const read = await statuses.ask([pr(2), pr(3)]);
    expect(asks).toEqual([
      { full: true, refs: ['acme/app#2'] },
      { full: false, refs: ['acme/app#3'] },
      { full: true, refs: ['acme/app#3'] },
    ]);
    expect(read.statuses).toEqual({ 'acme/app#2': { state: 'merged' }, 'acme/app#3': { state: 'open', draft: false, review: 'approved', checks: 'passed', conflict: false } });
  });

  it('gives no status for a PR GitHub did not find, and still the others’', async () => {
    const { gh } = fakeGh({ 'acme/app#2': merged });
    expect(await new PrStatuses(gh).ask([pr(1), pr(2)])).toEqual({ statuses: { 'acme/app#2': { state: 'merged' } }, problem: null });
  });

  it('says why when gh does not answer, keeping what it had, and logs it', async () => {
    const { gh, state } = fakeGh({ 'acme/app#1': merged, 'acme/app#2': OPEN_NODE });
    const statuses = new PrStatuses(gh);
    await statuses.ask([pr(1), pr(2)]);
    state.failure = { code: 4, stdout: '', stderr: '' };
    expect(await statuses.ask([pr(1), pr(2)])).toEqual({
      statuses: { 'acme/app#1': { state: 'merged' }, 'acme/app#2': { state: 'open', draft: false, review: 'review-required', checks: 'passed', conflict: false } },
      problem: 'gh is not logged in; run gh auth login',
    });
    expect(logged).toEqual(['warn prs no PR status: gh is not logged in; run gh auth login']);
  });

  it('asks the state alone 100 PRs a request, and every field 25', async () => {
    const github = Object.fromEntries(Array.from({ length: 130 }, (_, index) => [`acme/app#${index + 1}`, index < 30 ? OPEN_NODE : merged]));
    const { gh, asks } = fakeGh(github);
    await new PrStatuses(gh).ask(Array.from({ length: 130 }, (_, index) => pr(index + 1)));
    expect(asks.map(({ full, refs }) => [full, refs.length])).toEqual([
      [false, 100],
      [false, 30],
      [true, 25],
      [true, 5],
    ]);
  });

  it('asks a PR named twice once, and never one whose repository is not owner/name', async () => {
    const { gh, asks } = fakeGh({ 'acme/app#1': merged });
    const read = await new PrStatuses(gh).ask([pr(1), pr(1), pr(2, 'nobody')]);
    expect(asks).toEqual([{ full: false, refs: ['acme/app#1'] }]);
    expect(read.statuses).toEqual({ 'acme/app#1': { state: 'merged' } });
  });

  it('asks nothing for no PRs', async () => {
    const { gh, asks } = fakeGh({});
    expect(await new PrStatuses(gh).ask([])).toEqual({ statuses: {}, problem: null });
    expect(asks).toEqual([]);
  });
});
