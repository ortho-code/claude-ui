import { prKey } from '../../shared/sessions/prs';
import type { SessionPr } from '../../shared/types';
import { postedPrs } from './posted-prs';
import { shellCommands } from './tool-calls';

/**
 * The PRs a transcript links, read record by record, by `prKey`.
 * Claude Code writes the same record again through a session, so each is kept once, where it first appears, as spelt there.
 */
export class TranscriptPrs {
  private readonly byKey = new Map<string, SessionPr>();

  /** A `pr-link` record, as Claude Code writes one when a session opens or links a PR. */
  linked(event: Record<string, unknown>): void {
    const pr = linkedPr(event);
    if (pr) this.keep(pr);
  }

  /** An assistant record: a review or comment claude posted links its PR, since Claude Code links none for a review, nor for a comment posted through `gh api`. */
  posted(event: Record<string, unknown>): void {
    for (const command of shellCommands(event)) for (const pr of postedPrs(command)) this.keep(pr);
  }

  /** The PRs, in the order first linked. */
  get all(): SessionPr[] {
    return [...this.byKey.values()];
  }

  private keep(pr: SessionPr): void {
    const key = prKey(pr);
    if (!this.byKey.has(key)) this.byKey.set(key, pr);
  }
}

/** The PR a `pr-link` record names, or null for a record this cannot use: its number a positive whole number, its repository a name, its page an https address. */
function linkedPr(event: Record<string, unknown>): SessionPr | null {
  const { prNumber, prRepository, prUrl } = event;
  if (typeof prNumber !== 'number' || !Number.isInteger(prNumber) || prNumber <= 0) return null;
  if (typeof prRepository !== 'string' || !prRepository) return null;
  if (typeof prUrl !== 'string' || !prUrl.startsWith('https://')) return null;
  return { repository: prRepository, number: prNumber, url: prUrl };
}
