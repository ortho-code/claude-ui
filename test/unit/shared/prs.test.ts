import { describe, it, expect } from 'vitest';
import { approvalsProblem, approvalsRequired, roleOf } from '../../../src/shared/prs';

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
