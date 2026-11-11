import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} } }));
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()), log: () => {} }));
vi.mock('../../../../src/main/sessions/meta', () => ({ addPrLink: () => Promise.resolve() }));

import { findCreated, findQueryArgs, foundUrl } from '../../../../src/main/sessions/pr-find';
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

describe('findCreated', () => {
  const answering = (data: unknown): GhRun => ({ code: 0, stdout: JSON.stringify({ data }), stderr: '' });

  it('links each found PR to the session that opened it, and says which', async () => {
    const link = vi.fn(() => Promise.resolve());
    const other: PrToFind = { id: 's2', repository: 'acme/app', head: 'none-yet', at: FORK.at };
    const result = await findCreated([FORK, other], () => Promise.resolve(answering({ r0: ANSWERED, r1: { pullRequests: { nodes: [] } } })), link);
    expect(result).toEqual({ found: [{ create: FORK, url: 'https://github.com/ScientaNL/scienta/pull/36788' }], problem: null });
    expect(link.mock.calls).toEqual([['s1', 'https://github.com/ScientaNL/scienta/pull/36788']]);
  });

  it('links nothing and says why when gh gives no answer', async () => {
    const link = vi.fn(() => Promise.resolve());
    const result = await findCreated([FORK], () => Promise.resolve({ code: 4, stdout: '', stderr: '' }), link);
    expect(result).toEqual({ found: [], problem: 'gh is not logged in; run gh auth login' });
    expect(link).not.toHaveBeenCalled();
  });

  it('never asks for a repository that is not owner/name', async () => {
    const gh = vi.fn(() => Promise.resolve(answering({})));
    expect(await findCreated([{ ...FORK, repository: 'nobody' }], gh)).toEqual({ found: [], problem: null });
    expect(gh).not.toHaveBeenCalled();
  });
});
