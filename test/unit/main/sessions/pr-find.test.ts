import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} } }));
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()), log: () => {} }));
vi.mock('../../../../src/main/sessions/meta', () => ({ addPrLink: () => Promise.resolve() }));

import { findAndLink, findQueryArgs, foundUrl, nodeQueryArgs, numberQueryArgs } from '../../../../src/main/sessions/pr-find';
import type { GhRun } from '../../../../src/main/sessions/pr-status';
import type { PrToFind } from '../../../../src/shared/types';

/** The PR session 2a3c1b9a opened in the browser on 2026-11-09, as it asked for it. */
const FORK: PrToFind = { id: 's1', repository: 'ScientaNL/Scienta', head: 'alleknalle:setup-creates-the-host-folders-of-nested-volumes', at: '2026-11-09T09:21:32.000Z' };

/** What GitHub answered for that branch on 2026-11-11. */
const ANSWERED = { pullRequests: { nodes: [{ url: 'https://github.com/ScientaNL/scienta/pull/36788', createdAt: '2026-11-09T09:22:45Z', headRepositoryOwner: { login: 'alleknalle' } }] } };

const node = (url: string, createdAt: string, login = 'alleknalle') => ({ url, createdAt, headRepositoryOwner: { login } });

describe('findQueryArgs', () => {
  it('asks each branch in its repository, newest first, the owner, name and branch as variables', () => {
    expect(findQueryArgs([FORK])).toEqual([
      '-f',
      'query=query($o0:String!,$n0:String!,$h0:String!){r0:repository(owner:$o0,name:$n0){pullRequests(headRefName:$h0,first:5,orderBy:{field:CREATED_AT,direction:DESC}){nodes{url createdAt headRepositoryOwner{login}}}}}',
      '-f',
      'o0=ScientaNL',
      '-f',
      'n0=Scienta',
      '-f',
      'h0=setup-creates-the-host-folders-of-nested-volumes',
    ]);
  });
});

describe('nodeQueryArgs', () => {
  it('asks each id for the PR it belongs to, whichever of a review, a thread, a comment or a PR it is, the id as a variable', () => {
    expect(nodeQueryArgs([{ id: 's1', node: 'PRR_kwDOAHFIWc8AAAABXz2W6w', at: FORK.at }])).toEqual([
      '-f',
      'query=query($n0:ID!){n0:node(id:$n0){...on PullRequestReview{pullRequest{url}} ...on PullRequestReviewThread{pullRequest{url}} ...on PullRequestReviewComment{pullRequest{url}} ...on PullRequest{url}}}',
      '-f',
      'n0=PRR_kwDOAHFIWc8AAAABXz2W6w',
    ]);
  });
});

describe('numberQueryArgs', () => {
  it('asks each number in its repository whether it is an issue or a PR, the owner, name and number as variables', () => {
    expect(numberQueryArgs([{ id: 's1', repository: 'zircote/swagger-php', number: 2017, at: FORK.at }])).toEqual([
      '-f',
      'query=query($o0:String!,$n0:String!,$i0:Int!){m0:repository(owner:$o0,name:$n0){issueOrPullRequest(number:$i0){__typename ...on PullRequest{url}}}}',
      '-f',
      'o0=zircote',
      '-f',
      'n0=swagger-php',
      '-F',
      'i0=2017',
    ]);
  });
});

describe('foundUrl', () => {
  it('takes the PR made from the fork the head names after the command ran', () => {
    expect(foundUrl(FORK, ANSWERED)).toBe('https://github.com/ScientaNL/scienta/pull/36788');
  });

  it('passes over a PR made before the command, or from another fork, for the newest that fits', () => {
    const nodes = [node('https://x/3', '2026-11-09T10:00:00Z', 'someone'), node('https://x/2', '2026-11-09T09:30:00Z'), node('https://x/1', '2026-11-01T00:00:00Z')];
    expect(foundUrl(FORK, { pullRequests: { nodes } })).toBe('https://x/2');
    expect(foundUrl(FORK, { pullRequests: { nodes: [nodes[0], nodes[2]] } })).toBeNull();
  });

  it('takes a PR the clock says was made up to a minute before the command, and from any owner for a branch alone', () => {
    expect(foundUrl(FORK, { pullRequests: { nodes: [node('https://x/1', '2026-11-09T09:20:40Z')] } })).toBe('https://x/1');
    expect(foundUrl({ ...FORK, head: 'fix' }, { pullRequests: { nodes: [node('https://x/1', '2026-11-09T10:00:00Z', 'anyone')] } })).toBe('https://x/1');
  });

  it('finds nothing in an answer that has no PRs for the branch', () => {
    expect(foundUrl(FORK, { pullRequests: { nodes: [] } })).toBeNull();
    expect(foundUrl(FORK, null)).toBeNull();
  });
});

describe('findAndLink', () => {
  const answering = (data: unknown): GhRun => ({ code: 0, stdout: JSON.stringify({ data }), stderr: '' });

  it('links each found PR to the session that opened it, and says which', async () => {
    const link = vi.fn(() => Promise.resolve());
    const other: PrToFind = { id: 's2', repository: 'acme/app', head: 'none-yet', at: FORK.at };
    const result = await findAndLink([FORK, other], () => Promise.resolve(answering({ r0: ANSWERED, r1: { pullRequests: { nodes: [] } } })), link);
    expect(result).toEqual({ found: [{ asked: FORK, url: 'https://github.com/ScientaNL/scienta/pull/36788' }], notPrs: [], problem: null });
    expect(link.mock.calls).toEqual([['s1', 'https://github.com/ScientaNL/scienta/pull/36788']]);
  });

  it('links nothing and says why when gh gives no answer', async () => {
    const link = vi.fn(() => Promise.resolve());
    const result = await findAndLink([FORK], () => Promise.resolve({ code: 4, stdout: '', stderr: '' }), link);
    expect(result).toEqual({ found: [], notPrs: [], problem: 'gh is not logged in; run gh auth login' });
    expect(link).not.toHaveBeenCalled();
  });

  // Asked on 2026-11-17: a review, a thread, a comment and the PR itself each resolved to #36867; an id GitHub does not know comes back null, gh exiting 1 with the rest answered.
  it('links the PR each posted id belongs to, by a review, a thread, a comment or the PR itself, and passes over an id GitHub does not know', async () => {
    const link = vi.fn(() => Promise.resolve());
    const at = '2026-11-13T10:00:00.000Z';
    const posted: PrToFind[] = [
      { id: 's1', node: 'PRR_kwDOAHFIWc8AAAABXz2W6w', at },
      { id: 's2', node: 'PR_kwDOAHFIWc8AAAABO5dE8A', at },
      { id: 's3', node: 'PRR_doesnotexist', at },
    ];
    const url = 'https://github.com/ScientaNL/scienta/pull/36867';
    const answer = { code: 1, stdout: JSON.stringify({ data: { n0: { pullRequest: { url } }, n1: { url }, n2: null } }), stderr: "gh: Could not resolve to a node with the global id of 'PRR_doesnotexist'" };
    const result = await findAndLink(posted, () => Promise.resolve(answer), link);
    expect(result).toEqual({ found: [{ asked: posted[0], url }, { asked: posted[1], url }], notPrs: [], problem: null });
    expect(link.mock.calls).toEqual([['s1', url], ['s2', url]]);
  });

  // Asked on 2026-11-23: zircote/swagger-php #2017 is an issue and ScientaNL/scienta #36555 a PR; a number GitHub does not know comes back null.
  it('links a number a comment was posted on that is a PR, says which are issues, and passes over a number GitHub does not know', async () => {
    const link = vi.fn(() => Promise.resolve());
    const at = '2026-11-23T21:29:38.426Z';
    const posted: PrToFind[] = [
      { id: 's1', repository: 'zircote/swagger-php', number: 2017, at },
      { id: 's2', repository: 'ScientaNL/scienta', number: 36555, at },
      { id: 's3', repository: 'acme/app', number: 99999, at },
    ];
    const url = 'https://github.com/ScientaNL/scienta/pull/36555';
    const answer = { code: 1, stdout: JSON.stringify({ data: { m0: { issueOrPullRequest: { __typename: 'Issue' } }, m1: { issueOrPullRequest: { __typename: 'PullRequest', url } }, m2: { issueOrPullRequest: null } } }), stderr: 'gh: Could not resolve to an issue or pull request with the number of 99999.' };
    const result = await findAndLink(posted, () => Promise.resolve(answer), link);
    expect(result).toEqual({ found: [{ asked: posted[1], url }], notPrs: [posted[0]], problem: null });
    expect(link.mock.calls).toEqual([['s2', url]]);
  });

  it('asks for creates and posted ids in requests of their own', async () => {
    const gh = vi.fn((args: readonly string[]) => Promise.resolve(answering(args.some((arg) => arg.includes('node(id:')) ? { n0: { pullRequest: { url: 'https://github.com/acme/app/pull/2' } } } : { r0: ANSWERED })));
    const result = await findAndLink([FORK, { id: 's2', node: 'PRR_kwDOAAAAAAAAAAAAone', at: FORK.at }], gh);
    expect(result.found.map((each) => each.url)).toEqual(['https://github.com/ScientaNL/scienta/pull/36788', 'https://github.com/acme/app/pull/2']);
    expect(gh).toHaveBeenCalledTimes(2);
  });

  it('never asks for a repository that is not owner/name', async () => {
    const gh = vi.fn(() => Promise.resolve(answering({})));
    expect(await findAndLink([{ ...FORK, repository: 'nobody' }], gh)).toEqual({ found: [], notPrs: [], problem: null });
    expect(gh).not.toHaveBeenCalled();
  });
});
