import { ipcMain } from 'electron';
import type { PendingNode, PendingPr, PrToFind, PrsFound } from '../../shared/types';
import { log } from '../logs/log';
import { addPrLink } from './meta';
import { failureOf, runGh, type RunGh } from './pr-status';

/**
 * Finding the PR a session created (`SessionSummary.prCreates`), or posted on by an id (`SessionSummary.postedNodes`), and linking it to that session as the app's own link (`addPrLink`), as a panel row's PR is linked.
 * For a created one, GitHub is asked for the PRs made from the branch in the repository the command named, newest first, and the one taken is the newest made after the command ran, from the fork the branch names where it names one, so an older PR from a reused branch is never linked.
 * For a posted id, GitHub is asked which PR the review, review thread, review comment or PR it names belongs to.
 */

type Create = PendingPr & { id: string };
type Posted = PendingNode & { id: string };

const isPosted = (toFind: PrToFind): toFind is Posted => 'node' in toFind;

/** How long before the command's time a PR may say it was made and still be the command's, for a clock on this machine that runs ahead of GitHub's. */
const CLOCK_SLACK_MS = 60_000;

/** The most PRs of one branch asked, newest first: a branch reused for this many PRs before is past what one look needs. */
const PER_BRANCH = 5;

/** The most branches one request asks, as the PR status asks its PRs a request at a time. */
const PER_REQUEST = 25;

/** The `gh api graphql` arguments asking each of `creates` for the newest PRs made from its branch, aliased `r0`, `r1`…, every name a variable so nothing a transcript wrote is read as query syntax. */
export function findQueryArgs(creates: readonly Create[]): string[] {
  const declared = creates.map((_, at) => `$o${at}:String!,$n${at}:String!,$h${at}:String!`).join(',');
  const fields = creates.map((_, at) => `r${at}:repository(owner:$o${at},name:$n${at}){pullRequests(headRefName:$h${at},first:${PER_BRANCH},orderBy:{field:CREATED_AT,direction:DESC}){nodes{url createdAt headRepositoryOwner{login}}}}`);
  const variables = creates.flatMap((create, at) => {
    const [owner, name] = create.repository.split('/');
    return ['-f', `o${at}=${owner}`, '-f', `n${at}=${name}`, '-f', `h${at}=${branchOf(create.head)}`];
  });
  return ['-f', `query=query(${declared}){${fields.join(' ')}}`, ...variables];
}

/** The `gh api graphql` arguments asking which PR each of `posted` names, aliased `n0`, `n1`…, each id a variable. */
export function nodeQueryArgs(posted: readonly Posted[]): string[] {
  const declared = posted.map((_, at) => `$n${at}:ID!`).join(',');
  const fields = posted.map((_, at) => `n${at}:node(id:$n${at}){...on PullRequestReview{pullRequest{url}} ...on PullRequestReviewThread{pullRequest{url}} ...on PullRequestReviewComment{pullRequest{url}} ...on PullRequest{url}}`);
  return ['-f', `query=query(${declared}){${fields.join(' ')}}`, ...posted.flatMap((each, at) => ['-f', `n${at}=${each.node}`])];
}

/** The page of the PR GitHub's answer for an id names: the PR a review, thread or comment is on, or the PR itself; null for an id it does not know. */
function nodeUrl(answer: unknown): string | null {
  if (!isObject(answer)) return null;
  if (isObject(answer.pullRequest) && typeof answer.pullRequest.url === 'string') return answer.pullRequest.url;
  return typeof answer.url === 'string' ? answer.url : null;
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
export function foundUrl(create: Create, repository: unknown): string | null {
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

type Link = (id: string, url: string) => Promise<void>;

/**
 * Find the PR each of `toFind` is, those created and those posted on by an id each in requests of their own, `PER_REQUEST` at a time, linking each found one to its session.
 * GitHub answers an id it does not know with null beside the others, and `gh` then exits with an error, so an answer is read whatever the exit; the first request with no answer at all stops the rest, and says why.
 */
export async function findAndLink(toFind: readonly PrToFind[], gh: RunGh = (args) => runGh(args), link: Link = addPrLink): Promise<PrsFound> {
  const creates = toFind.filter((each): each is Create => !isPosted(each) && /^[^/\s]+\/[^/\s]+$/.test(each.repository) && branchOf(each.head) !== '');
  const found: PrsFound['found'] = [];
  const problem =
    (await findIn(creates, findQueryArgs, (create, data, at) => foundUrl(create, data[`r${at}`]), { gh, link, found })) ??
    (await findIn(toFind.filter(isPosted), nodeQueryArgs, (_, data, at) => nodeUrl(data[`n${at}`]), { gh, link, found }));
  return { found, problem };
}

/** Ask for `asked` a request per `PER_REQUEST`, by `queryArgs`, read each one's PR from the answer by `urlOf`, link it and add it to `found`; why the first request with no answer failed, or null. */
async function findIn<T extends PrToFind>(asked: readonly T[], queryArgs: (run: readonly T[]) => string[], urlOf: (each: T, data: Record<string, unknown>, at: number) => string | null, { gh, link, found }: { gh: RunGh; link: Link; found: PrsFound['found'] }): Promise<string | null> {
  for (let start = 0; start < asked.length; start += PER_REQUEST) {
    const run = asked.slice(start, start + PER_REQUEST);
    const result = await gh(queryArgs(run));
    let data: unknown;
    try {
      data = (JSON.parse(result.stdout) as { data?: unknown }).data;
    } catch {
      data = null;
    }
    if (!isObject(data)) {
      const problem = failureOf(result);
      log('warn', 'prs', `no PR found for a create or a posted id: ${problem}`);
      return problem;
    }
    for (const [at, each] of run.entries()) {
      const url = urlOf(each, data, at);
      if (url === null) continue;
      await link(each.id, url);
      found.push({ asked: each, url });
    }
  }
  return null;
}

/** The PRs to find the window sent; anything that is not one is left out. */
function prsToFind(value: unknown): PrToFind[] {
  if (!Array.isArray(value)) return [];
  const has = (each: Record<string, unknown>, fields: readonly string[]): boolean => fields.every((field) => typeof each[field] === 'string');
  return value.filter((each): each is PrToFind => isObject(each) && (has(each, ['id', 'repository', 'head', 'at']) || has(each, ['id', 'node', 'at'])));
}

export function registerPrFind(): void {
  ipcMain.handle('prs:find', (_event, toFind: unknown) => findAndLink(prsToFind(toFind)));
}
