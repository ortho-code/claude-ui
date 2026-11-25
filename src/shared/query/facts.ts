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
  /** Every stored reason, those read or muted by a set-aside mark included. */
  reasons(session: SessionSummary): readonly NeedsYou[];
  /** Claude waiting for you, or ready and not marked read; null otherwise. */
  claudeAsks(session: SessionSummary): ClaudeAsk | null;
  /** It shows the worktree mark. */
  worktree(session: SessionSummary): boolean;
  /** It cannot run because its folder is gone. */
  gone(session: SessionSummary): boolean;
  prRole(pr: SessionPr): PrRole | null;
  prStates(pr: SessionPr): ReadonlySet<PrState>;
  prTitle(pr: SessionPr): string | undefined;
}
