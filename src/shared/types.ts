export interface SessionSummary {
  /** Session id, taken from the .jsonl filename. */
  id: string;
  /** Absolute working directory the session ran in. */
  cwd: string;
  /** First user message, trimmed for display. Empty when none was found. */
  firstMessage: string;
  /** Last activity as an ISO timestamp (file mtime). */
  lastActivity: string;
  /** Number of transcript lines (events) in the session. */
  eventCount: number;
}

export interface ClaudeUiApi {
  listSessions(): Promise<SessionSummary[]>;
}
