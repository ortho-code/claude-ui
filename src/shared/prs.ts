import type { PrRole, SessionPr } from './types';

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
