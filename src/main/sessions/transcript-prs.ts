import { prKey } from '../../shared/sessions/prs';
import type { PendingPr, SessionPr } from '../../shared/types';
import { postedPrs, webCreates } from './posted-prs';
import { shellCommands } from './tool-calls';

/**
 * The PRs a transcript links, read record by record, by `prKey`.
 * Claude Code writes the same record again through a session, so each is kept once, where it first appears, as spelt there.
 */
export class TranscriptPrs {
  private readonly byKey = new Map<string, SessionPr>();
  private readonly creates = new Map<string, PendingPr>();

  /** A `pr-link` record, as Claude Code writes one when a session opens or links a PR. */
  linked(event: Record<string, unknown>): void {
    const pr = linkedPr(event);
    if (pr) this.keep(pr);
  }

  /**
   * An assistant record: a review or comment claude posted links its PR, since Claude Code links none for a review, nor for a comment posted through `gh api`.
   * A PR it opened in the browser to be created is kept apart, with when, since there is no PR yet to link.
   */
  posted(event: Record<string, unknown>): void {
    for (const command of shellCommands(event)) {
      for (const pr of postedPrs(command)) this.keep(pr);
      if (typeof event.timestamp !== 'string') continue;
      for (const create of webCreates(command)) {
        const key = `${create.repository.toLowerCase()}\n${create.head}`;
        // Moved to the end with its newer time: a second try on the same branch is the one its PR follows.
        this.creates.delete(key);
        this.creates.set(key, { ...create, at: event.timestamp });
      }
    }
  }

  /** The PRs, in the order first linked. */
  get all(): SessionPr[] {
    return [...this.byKey.values()];
  }

  /** The PRs opened in the browser to be created, each repository and branch once, oldest first. */
  get webCreates(): PendingPr[] {
    return [...this.creates.values()];
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
