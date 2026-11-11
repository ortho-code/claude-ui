import { ipcMain } from 'electron';
import type { PrToFind, PrsFound } from '../../shared/types';
import { log } from '../logs/log';
import { addPrLink } from './meta';
import { failureOf, runGh, type RunGh } from './pr-status';

/**
 * Finding the PR a session opened in the browser to be created (`SessionSummary.webCreates`), and linking it to that session as the app's own link (`addPrLink`), as a panel row's PR is linked.
 * GitHub is asked for the PRs made from the branch in the repository the command named, newest first, and the one taken is the newest made after the command ran, from the fork the branch names where it names one, so an older PR from a reused branch is never linked.
 */

/** How long before the command's time a PR may say it was made and still be the command's, for a clock on this machine that runs ahead of GitHub's. */
const CLOCK_SLACK_MS = 60_000;

/** The most PRs of one branch asked, newest first: a branch reused for this many PRs before is past what one look needs. */
const PER_BRANCH = 5;

/** The most branches one request asks, as the PR status asks its PRs a request at a time. */
const PER_REQUEST = 25;

/** The `gh api graphql` arguments asking each of `creates` for the newest PRs made from its branch, aliased `r0`, `r1`…, every name a variable so nothing a transcript wrote is read as query syntax. */
export function findQueryArgs(creates: readonly PrToFind[]): string[] {
  const declared = creates.map((_, at) => `$o${at}:String!,$n${at}:String!,$h${at}:String!`).join(',');
  const fields = creates.map((_, at) => `r${at}:repository(owner:$o${at},name:$n${at}){pullRequests(headRefName:$h${at},first:${PER_BRANCH},orderBy:{field:CREATED_AT,direction:DESC}){nodes{url createdAt headRepositoryOwner{login}}}}`);
  const variables = creates.flatMap((create, at) => {
    const [owner, name] = create.repository.split('/');
    return ['-f', `o${at}=${owner}`, '-f', `n${at}=${name}`, '-f', `h${at}=${branchOf(create.head)}`];
  });
  return ['-f', `query=query(${declared}){${fields.join(' ')}}`, ...variables];
}

/** The branch a head names, without the fork's owner before a colon. */
function branchOf(head: string): string {
  return head.slice(head.indexOf(':') + 1);
}

/** The fork's owner a head names before a colon, null for a branch alone. */
function ownerOf(head: string): string | null {
  const colon = head.indexOf(':');
  return colon === -1 ? null : head.slice(0, colon);
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The page of the PR `create` became, from GitHub's answer for its branch: the newest made no earlier than the command ran (`CLOCK_SLACK_MS` aside), from the fork its head names where it names one; null for none yet.
 */
export function foundUrl(create: PrToFind, repository: unknown): string | null {
  const nodes = isObject(repository) && isObject(repository.pullRequests) ? repository.pullRequests.nodes : null;
  if (!Array.isArray(nodes)) return null;
  const since = Date.parse(create.at) - CLOCK_SLACK_MS;
  const owner = ownerOf(create.head)?.toLowerCase() ?? null;
  for (const node of nodes) {
    if (!isObject(node) || typeof node.url !== 'string' || typeof node.createdAt !== 'string') continue;
    if (Date.parse(node.createdAt) < since) continue;
    const login = isObject(node.headRepositoryOwner) && typeof node.headRepositoryOwner.login === 'string' ? node.headRepositoryOwner.login.toLowerCase() : null;
    if (owner === null || login === owner) return node.url;
  }
  return null;
}

/** Find what each of `creates` became, a request per `PER_REQUEST`, linking each found one to its session; the first request with no answer stops the rest, and says why. */
export async function findCreated(creates: readonly PrToFind[], gh: RunGh = (args) => runGh(args), link: (id: string, url: string) => Promise<void> = addPrLink): Promise<PrsFound> {
  const named = creates.filter((create) => /^[^/\s]+\/[^/\s]+$/.test(create.repository) && branchOf(create.head) !== '');
  const found: PrsFound['found'] = [];
  for (let start = 0; start < named.length; start += PER_REQUEST) {
    const run = named.slice(start, start + PER_REQUEST);
    const result = await gh(findQueryArgs(run));
    let data: unknown;
    try {
      data = (JSON.parse(result.stdout) as { data?: unknown }).data;
    } catch {
      data = null;
    }
    if (!isObject(data)) {
      const problem = failureOf(result);
      log('warn', 'prs', `no PR found for a browser create: ${problem}`);
      return { found, problem };
    }
    for (const [at, create] of run.entries()) {
      const url = foundUrl(create, data[`r${at}`]);
      if (url === null) continue;
      await link(create.id, url);
      found.push({ create, url });
    }
  }
  return { found, problem: null };
}

/** The PRs to find the window sent; anything that is not one is left out. */
function prsToFind(value: unknown): PrToFind[] {
  if (!Array.isArray(value)) return [];
  return value.filter((each): each is PrToFind => isObject(each) && ['id', 'repository', 'head', 'at'].every((field) => typeof each[field] === 'string'));
}

export function registerPrFind(): void {
  ipcMain.handle('prs:find', (_event, creates: unknown) => findCreated(prsToFind(creates)));
}
