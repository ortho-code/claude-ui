import type { SessionPr } from './types';

/**
 * A PR's full reference, `owner/repo#number`: what tells two of a session's PRs apart, what the app shows for one, and what search matches.
 * One function for all three, so what is shown is what is searched and what is kept once.
 */
export function prReference(pr: Pick<SessionPr, 'repository' | 'number'>): string {
  return `${pr.repository}#${pr.number}`;
}
