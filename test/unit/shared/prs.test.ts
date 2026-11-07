import { describe, it, expect } from 'vitest';
import { approvalsProblem, approvalsRequired, prFromUrl, prKey, roleOf, withPrLinks } from '../../../src/shared/prs';

describe('withPrLinks', () => {
  const pr = (repository: string, number: number) => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });

  it('puts the PRs the app linked a session to before the transcript’s, each PR once whatever its repository’s capitals', () => {
    const sessions = [{ id: 's', prs: [pr('acme/app', 1), pr('acme/app', 2)] }];
    expect(withPrLinks(sessions, { s: [pr('Acme/App', 2), pr('acme/app', 3)] })).toEqual([{ id: 's', prs: [pr('Acme/App', 2), pr('acme/app', 3), pr('acme/app', 1)] }]);
  });

  it('leaves a session the app linked to nothing as it was', () => {
    const sessions = [{ id: 's', prs: [pr('acme/app', 1)] }];
    expect(withPrLinks(sessions, { t: [pr('acme/app', 9)] })).toEqual(sessions);
  });
});

describe('prFromUrl', () => {
  it('reads a pull request page, and one under its files or a comment, as the PR’s own page', () => {
    const pr = { repository: 'acme/app', number: 9, url: 'https://github.com/acme/app/pull/9' };
    expect(prFromUrl('https://github.com/acme/app/pull/9')).toEqual(pr);
    expect(prFromUrl('https://github.com/acme/app/pull/9/files#diff-1')).toEqual(pr);
  });

  it('reads no other address as a PR', () => {
    expect(prFromUrl('https://github.com/acme/app/issues/9')).toBeNull();
    expect(prFromUrl('https://github.com/acme/app/pull/0')).toBeNull();
    expect(prFromUrl('http://github.com/acme/app/pull/9')).toBeNull();
    expect(prFromUrl('https://example.com/acme/app/pull/9')).toBeNull();
  });
});

describe('prKey', () => {
  it('tells PRs apart without regard to their repository’s capitals', () => {
    expect(prKey({ repository: 'ScientaNL/Scienta', number: 5 })).toBe(prKey({ repository: 'scientanl/scienta', number: 5 }));
    expect(prKey({ repository: 'acme/app', number: 5 })).not.toBe(prKey({ repository: 'acme/app', number: 6 }));
  });
});

describe('approvalsProblem', () => {
  it('takes repositories as owner/name, each with a whole number of 1 or more', () => {
    expect(approvalsProblem({})).toBeNull();
    expect(approvalsProblem({ 'ScientaNL/scienta': 2, 'acme/app': 1 })).toBeNull();
  });

  it('names every mistake: a value that is no object, a name that is not owner/name, a count below 1 or not whole, one repository named twice in different cases', () => {
    expect(approvalsProblem([2])).toBe('It has to be an object of repositories and the approvals each needs, such as { "acme/app": 2 }.');
    expect(approvalsProblem({ acme: 2, 'acme/app': 0, 'acme/lib': 1.5, 'Acme/Lib': 1 })).toBe(
      '"acme" is not a repository written as owner/name. "acme/app" needs a whole number of 1 or more. "acme/lib" needs a whole number of 1 or more. "acme/lib" and "Acme/Lib" name one repository.',
    );
  });
});

describe('approvalsRequired', () => {
  it('is the repository’s number, matched in any case, and null for one not named', () => {
    expect(approvalsRequired({ 'ScientaNL/Scienta': 2 }, 'ScientaNL/scienta')).toBe(2);
    expect(approvalsRequired({ 'ScientaNL/Scienta': 2 }, 'acme/app')).toBeNull();
  });
});

describe('roleOf', () => {
  it('is own for a PR you wrote, whatever else holds', () => {
    expect(roleOf(true, false, false)).toBe('own');
    expect(roleOf(true, true, true)).toBe('own');
  });

  it('is reviewing for someone else’s PR you reviewed or are asked to review', () => {
    expect(roleOf(false, true, false)).toBe('reviewing');
    expect(roleOf(false, false, true)).toBe('reviewing');
  });

  it('is other for someone else’s PR with neither', () => {
    expect(roleOf(false, false, false)).toBe('other');
  });
});
