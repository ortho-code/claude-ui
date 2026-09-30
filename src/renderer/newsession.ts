import type { SessionSummary } from '../shared/types';

/**
 * A session with no transcript yet, as the SessionSummary defaults plus whatever the caller already knows.
 * One factory, so a SessionSummary field change lands here once instead of in four literals.
 *
 * THE ID IS THE REAL ONE, and the caller says what it is: minted here for a session the app is about to start (handed to claude as `--session-id`), or the id Claude Code reported for a session that replaced another in the same terminal.
 * Either way everything keyed by id — the sidebar row, a group, a pin, a note, the status file — is right from the first paint rather than being moved later.
 * Until claude writes the transcript the session exists only as this object, held by its tab; `visibleSessions` is what puts it in the sidebar in the meantime.
 */
export function newSession(id: string, over: Partial<SessionSummary> & Pick<SessionSummary, 'cwd' | 'repoRoot' | 'title'>): SessionSummary {
  return {
    id,
    conversationId: id,
    isRepo: false,
    worktree: '',
    firstMessage: '',
    model: '',
    lastActivity: new Date().toISOString(),
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
    // A session the app is about to start in a folder it just resolved: both are there, or the start would not have been offered.
    cwdExists: true,
    repoRootExists: true,
    ...over,
  };
}

/** What a session with nothing in it yet is called: the folder it runs in. Shared with a session `/clear` has just emptied, which is the same thing. */
export function untitledLabel(cwd: string): string {
  return `New: ${cwd.split('/').filter(Boolean).pop() ?? cwd}`;
}
