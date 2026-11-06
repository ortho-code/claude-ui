import type { PrRole, SessionPr } from './types';

/** The approvals each repository needs before a PR counts as approved, by `owner/name`, as `approvals` in settings.json holds them. */
export type Approvals = Readonly<Record<string, number>>;

/** Whether `value` may be `approvals`, and if not, every mistake in it. */
export function approvalsProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'It has to be an object of repositories and the approvals each needs, such as { "acme/app": 2 }.';
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [repository, count] of Object.entries(value)) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) problems.push(`"${repository}" is not a repository written as owner/name.`);
    if (!Number.isInteger(count) || (count as number) < 1) problems.push(`"${repository}" needs a whole number of 1 or more.`);
    const other = seen.get(repository.toLowerCase());
    if (other !== undefined) problems.push(`"${other}" and "${repository}" name one repository.`);
    seen.set(repository.toLowerCase(), repository);
  }
  return problems.length === 0 ? null : problems.join(' ');
}

/** The approvals `repository` needs, matched without regard to case, since a PR record may spell a repository either way; null where none is set, so GitHub's decision alone says approved. */
export function approvalsRequired(approvals: Approvals, repository: string): number | null {
  const wanted = repository.toLowerCase();
  return Object.entries(approvals).find(([named]) => named.toLowerCase() === wanted)?.[1] ?? null;
}

/** Every role, in the order a PR's role is decided: yours first, then one you review, then anyone else's. */
export const PR_ROLES: readonly PrRole[] = ['own', 'reviewing', 'other'];

/** Your role on a PR from what GitHub says: whether you wrote it, have a submitted review on it, and are asked to review it. */
export function roleOf(authored: boolean, reviewed: boolean, asked: boolean): PrRole {
  if (authored) return 'own';
  return reviewed || asked ? 'reviewing' : 'other';
}

/**
 * A PR's full reference, `owner/repo#number`: what tells two of a session's PRs apart, what the app shows for one, and what search matches.
 * One function for all three, so what is shown is what is searched and what is kept once.
 */
export function prReference(pr: Pick<SessionPr, 'repository' | 'number'>): string {
  return `${pr.repository}#${pr.number}`;
}
