import type { NeedsYou, PrRole, SessionPr, SessionSummary, SetAside } from '../types';

/** A state a PR is in, as `pr.state:` names it; an open PR can be in several at once. */
export type PrState = 'open' | 'draft' | 'merged' | 'closed' | 'changes-requested' | 'approved' | 'checks-failed' | 'checks-running' | 'conflict';

/** Claude's own ask of a session, as the needs-you type that names it. */
export type ClaudeAsk = 'claude.asks' | 'claude.ready';

/**
 * What a query's fields ask of a session beyond the session itself, answered by whoever holds that state: the window from its store, the main process from its own.
 * A PR's answers are null or empty while it is not known, as its mark reads it.
 */
export interface QueryFacts {
  now: number;
  /** The project `project:current` names, by its folder: the one on show where the query is asked, or null for every project. */
  current: string | null;
  pinned(session: SessionSummary): boolean;
  tabbed(session: SessionSummary): boolean;
  /** A claude runs in its tab. */
  running(session: SessionSummary): boolean;
  finished(session: SessionSummary): boolean;
  /** On its way to the trash. */
  deleting(session: SessionSummary): boolean;
  status(session: SessionSummary): string | undefined;
  setAside(session: SessionSummary): SetAside | undefined;
  /** When Keep was last pressed for it, in epoch ms. */
  kept(session: SessionSummary): number | undefined;
  note(session: SessionSummary): string | undefined;
  groupName(session: SessionSummary): string | undefined;
  projectName(session: SessionSummary): string;
  /** What its row is called: its title, else its first prompt, else a stand-in. */
  label(session: SessionSummary): string;
  /** Every stored reason, those read or muted by a set-aside mark included. */
  reasons(session: SessionSummary): readonly NeedsYou[];
  /** Claude waiting for you, or ready and not marked read; null otherwise. */
  claudeAsks(session: SessionSummary): ClaudeAsk | null;
  /** It asks for you now, by the rule its dot and the switcher's count follow: not read, not muted by its set-aside mark, not outranked by what its claude is doing. */
  asking(session: SessionSummary): boolean;
  /** Where what its dot shows stands in the strength order, lower first; null for a state the order does not name. */
  rank(session: SessionSummary): number | null;
  /** It shows the worktree mark. */
  worktree(session: SessionSummary): boolean;
  /** It cannot run because its folder is gone. */
  gone(session: SessionSummary): boolean;
  prRole(pr: SessionPr): PrRole | null;
  prStates(pr: SessionPr): ReadonlySet<PrState>;
  prTitle(pr: SessionPr): string | undefined;
}
