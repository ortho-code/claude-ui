import { spawn } from 'node:child_process';
import { ipcMain } from 'electron';
import { prReference } from '../shared/prs';
import type { PrRef, PrStatus, PrStatusRead } from '../shared/types';
import { log } from './log';
import { inheritedEnv, shellCommand, terminateGroup } from './shell';

/**
 * What GitHub says of the PRs the sessions link, asked with `gh api graphql` on the person's own `gh` login, and kept in memory for as long as the app runs.
 *
 * IN TWO STEPS, because asking more than a PR's state is slow (measured 2026-10-21, 103 PRs in one repository): 25 PRs with every field took 3.4–4.1 s, where the state alone of all 103 took under one.
 * So a PR not known yet, or closed, is asked its state alone, and one known to be open is asked every field; one that turns out to be open is then asked every field.
 * A merged PR is not asked again while the app runs.
 *
 * `gh` runs through the login shell (`shell.ts`), since it may be on `PATH` only through the shell's rc, as a mise install is; its stderr goes to fd 3, apart from the shell's own job-control lines on fd 2.
 */

/** Every field the colour needs, for a PR known to be open. */
const FULL_FIELDS = 'state isDraft reviewDecision mergeable commits(last:1){nodes{commit{statusCheckRollup{state}}}}';
const STATE_FIELDS = 'state';

/**
 * The most PRs one request asks, by how much it asks of each.
 * Measured 2026-10-21: one request for all 103 PRs, asking every field here and two more, failed once with an HTTP 502, where all nine requests for 25 that day answered, as did each of four for the state alone of all 103.
 */
const FULL_PER_REQUEST = 25;
const STATE_PER_REQUEST = 100;

/** How long one `gh` call may take before the ask gives up on it and it is stopped. */
const GH_TIMEOUT_MS = 30_000;

/** `gh`, its arguments given as positional parameters, so none is ever parsed as shell syntax. */
const GH_SCRIPT = 'exec gh api graphql "$@" 2>&3';

/** What one `gh` call ended with: its exit code (null when it ended on a signal or could not start), what it printed (nothing for a stopped one), and whether it was stopped for taking too long. */
export interface GhRun {
  code: number | null;
  stdout: string;
  stderr: string;
  stopped?: boolean;
}

export type RunGh = (args: string[]) => Promise<GhRun>;

/**
 * `gh api graphql` with `args`, through the login shell.
 * One that takes longer than `timeoutMs` is answered as stopped at once and its group stopped as a panel's run is (`terminateGroup`): SIGTERM, then SIGKILL if it has not gone after the grace period, since the interactive shell it starts as ignores SIGTERM until it has `exec`ed `gh` (`shell.ts`).
 */
export function runGh(args: string[], timeoutMs = GH_TIMEOUT_MS): Promise<GhRun> {
  return new Promise((resolve) => {
    const { file, args: shellArgs } = shellCommand(GH_SCRIPT, args, 'claude-ui-gh');
    // `detached` puts the child in a session of its own, so its pid is a group id the stop can signal (shell.ts).
    const child = spawn(file, shellArgs, { env: inheritedEnv(), detached: true, stdio: ['ignore', 'pipe', 'ignore', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let exited = false;
    const timer = setTimeout(() => {
      resolve({ code: null, stdout: '', stderr: '', stopped: true });
      if (child.pid !== undefined) terminateGroup(child.pid, () => !exited);
    }, timeoutMs);
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    const fd3 = child.stdio[3];
    if (fd3 && 'setEncoding' in fd3) fd3.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.on('exit', () => (exited = true));
    child.on('error', (error) => {
      exited = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/** A repository's PRs as one `repository` field of a query asks them. */
interface RepositoryAsk {
  repository: string;
  owner: string;
  name: string;
  numbers: number[];
}

/** A repository's owner and name, null for a reference that is not `owner/name`. */
function ownerAndName(repository: string): { owner: string; name: string } | null {
  const [owner, name, ...rest] = repository.split('/');
  return owner && name && rest.length === 0 ? { owner, name } : null;
}

/**
 * The PRs grouped by repository, in the order first met, which is the order of their `repository` fields in a query and of the aliases its answer comes back under.
 * A repository that is not `owner/name` is left out, so its PRs are never asked.
 */
function byRepository(prs: readonly PrRef[]): RepositoryAsk[] {
  const groups = new Map<string, RepositoryAsk>();
  for (const { repository, number } of prs) {
    const parts = ownerAndName(repository);
    if (!parts) continue;
    const group = groups.get(repository) ?? { repository, ...parts, numbers: [] };
    group.numbers.push(number);
    groups.set(repository, group);
  }
  return [...groups.values()];
}

/**
 * The `gh api graphql` arguments asking `fields` of each PR: a `repository` field per repository, aliased `r0`, `r1`…, holding a `pullRequest` field per PR, aliased `p<number>`.
 * A repository's owner and name go in as variables, so nothing a transcript wrote is read as query syntax; a number is a positive integer, the only kind the transcript reader and the IPC handler keep.
 */
export function prQueryArgs(prs: readonly PrRef[], fields: string): string[] {
  const groups = byRepository(prs);
  const declared = groups.map((_, index) => `$o${index}:String!,$n${index}:String!`).join(',');
  const parts = groups.map(({ numbers }, index) => {
    const pulls = numbers.map((number) => `p${number}:pullRequest(number:${number}){${fields}}`).join(' ');
    return `r${index}:repository(owner:$o${index},name:$n${index}){${pulls}}`;
  });
  const variables = groups.flatMap(({ owner, name }, index) => ['-f', `o${index}=${owner}`, '-f', `n${index}=${name}`]);
  return ['-f', `query=query(${declared}){${parts.join(' ')}}`, ...variables];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * What a request answered for each PR it asked, by reference: GitHub's node for it, or null where it found none; null for an answer with no `data` at all.
 * `gh` exits 1 when GitHub found some of what was asked and not the rest, and still prints the `data` it found (measured 2026-10-21 with a PR number and a repository that do not exist), which is read the same.
 */
export function answeredNodes(stdout: string, prs: readonly PrRef[]): Map<string, unknown> | null {
  let answer: unknown;
  try {
    answer = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isObject(answer) || !isObject(answer.data)) return null;
  const data = answer.data;
  const nodes = new Map<string, unknown>();
  byRepository(prs).forEach(({ repository, numbers }, index) => {
    const repo = data[`r${index}`];
    for (const number of numbers) nodes.set(prReference({ repository, number }), isObject(repo) ? (repo[`p${number}`] ?? null) : null);
  });
  return nodes;
}

/** A PR's state as GitHub gave it, null for none. */
export function stateOf(node: unknown): 'open' | 'merged' | 'closed' | null {
  const state = isObject(node) ? node.state : null;
  return state === 'OPEN' ? 'open' : state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : null;
}

/** GitHub's words for each part of an open PR's status, and the app's; a word not here is read as null. */
const REVIEWS = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes-requested', REVIEW_REQUIRED: 'review-required' } as const;
const CHECKS = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'running', EXPECTED: 'running' } as const;
const CONFLICTS = { CONFLICTING: true, MERGEABLE: false } as const;

/** The value `table` gives `key`, null where it gives none. */
function pick<T>(table: Record<string, T>, key: unknown): T | null {
  return typeof key === 'string' && Object.hasOwn(table, key) ? (table[key] ?? null) : null;
}

/** A PR's status from GitHub's node asked every field; a PR that has merged or closed since it was last asked carries its state alone. */
export function statusOf(node: unknown): PrStatus | null {
  const state = stateOf(node);
  if (state === null || !isObject(node)) return null;
  if (state !== 'open') return { state };
  const last: unknown = isObject(node.commits) && Array.isArray(node.commits.nodes) ? node.commits.nodes[0] : null;
  const rollup = isObject(last) && isObject(last.commit) && isObject(last.commit.statusCheckRollup) ? last.commit.statusCheckRollup : null;
  return {
    state,
    draft: node.isDraft === true,
    review: pick(REVIEWS, node.reviewDecision),
    checks: pick(CHECKS, rollup?.state),
    conflict: pick(CONFLICTS, node.mergeable),
  };
}

/**
 * Why a `gh` call gave no answer, in words for the person.
 * 127 is the shell's exit for a command it cannot find, and 4 is `gh`'s for one that needs a login (`gh help exit-codes`); otherwise the last line `gh` wrote says it.
 */
export function failureOf(run: GhRun): string {
  if (run.stopped) return `gh did not answer in ${GH_TIMEOUT_MS / 1000} s`;
  if (run.code === 127) return 'gh was not found';
  if (run.code === 4) return 'gh is not logged in; run gh auth login';
  const said = run.stderr.trim().split('\n').filter(Boolean).at(-1);
  if (said) return said.replace(/^gh: /, '');
  return run.code === null ? 'gh ended without an exit code' : `gh ended with exit code ${run.code}`;
}

/** `items` in runs of at most `size`. */
function chunks<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let at = 0; at < items.length; at += size) runs.push(items.slice(at, at + size));
  return runs;
}

/** What GitHub says of the PRs asked about, kept for the life of the app; one per app, made with the `gh` it runs. */
export class PrStatuses {
  private readonly known = new Map<string, PrStatus>();

  constructor(private readonly gh: RunGh = (args) => runGh(args)) {}

  /**
   * The last status GitHub gave for each of `prs`, by reference, after asking it again about every one not merged until a request gets no answer; and why it got none, where it did not.
   * A PR GitHub did not find, or has not answered for yet, has no status; one asked before keeps the status it had when a later ask fails.
   */
  async ask(prs: readonly PrRef[]): Promise<PrStatusRead> {
    const asked = [...new Map(prs.filter((pr) => ownerAndName(pr.repository) !== null).map((pr) => [prReference(pr), pr])).values()];
    const knownState = (pr: PrRef): PrStatus['state'] | undefined => this.known.get(prReference(pr))?.state;
    const open = asked.filter((pr) => knownState(pr) === 'open');
    const others = asked.filter((pr) => knownState(pr) !== 'open' && knownState(pr) !== 'merged');
    const nowOpen: PrRef[] = [];
    let problem = await this.fetch(open, FULL_FIELDS, FULL_PER_REQUEST, (pr, node) => this.keep(pr, statusOf(node)));
    problem ??= await this.fetch(others, STATE_FIELDS, STATE_PER_REQUEST, (pr, node) => {
      const state = stateOf(node);
      if (state === 'open') nowOpen.push(pr);
      else this.keep(pr, state === null ? null : { state });
    });
    problem ??= await this.fetch(nowOpen, FULL_FIELDS, FULL_PER_REQUEST, (pr, node) => this.keep(pr, statusOf(node)));
    if (problem !== null) log('warn', 'prs', `no PR status: ${problem}`);
    const statuses: Record<string, PrStatus> = {};
    for (const pr of asked) {
      const status = this.known.get(prReference(pr));
      if (status) statuses[prReference(pr)] = status;
    }
    return { statuses, problem };
  }

  /** Keep a PR's status; one GitHub gave none for is forgotten, so it is not shown as it was. */
  private keep(pr: PrRef, status: PrStatus | null): void {
    if (status) this.known.set(prReference(pr), status);
    else this.known.delete(prReference(pr));
  }

  /** Ask `fields` of `prs`, a request per `size`, handing each PR's node to `take`; the first request with no answer stops the rest, and says why. */
  private async fetch(prs: readonly PrRef[], fields: string, size: number, take: (pr: PrRef, node: unknown) => void): Promise<string | null> {
    for (const run of chunks(prs, size)) {
      const result = await this.gh(prQueryArgs(run, fields));
      const nodes = answeredNodes(result.stdout, run);
      if (nodes === null) return failureOf(result);
      for (const pr of run) take(pr, nodes.get(prReference(pr)));
    }
    return null;
  }
}

/** The PRs the renderer sent, as references; anything that is not one is left out. */
function prRefs(value: unknown): PrRef[] {
  if (!Array.isArray(value)) return [];
  return value.filter((pr): pr is PrRef => isObject(pr) && typeof pr.repository === 'string' && typeof pr.number === 'number' && Number.isInteger(pr.number) && pr.number > 0);
}

export function registerPrStatus(statuses = new PrStatuses()): void {
  ipcMain.handle('prs:status', (_event, prs: unknown) => statuses.ask(prRefs(prs)));
}
