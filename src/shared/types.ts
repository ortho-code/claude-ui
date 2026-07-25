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
  /** Session ids the user has pinned. */
  getPinned(): Promise<string[]>;
  /** Toggle a session's pin; resolves to the updated pinned list. */
  togglePin(id: string): Promise<string[]>;
  /**
   * Open a terminal in `cwd`. With `resumeSessionId`, resume that Claude
   * session; otherwise open a login shell. Resolves to a terminal id.
   */
  startTerminal(cwd: string, resumeSessionId?: string): Promise<number>;
  onTerminalData(callback: (id: number, data: string) => void): void;
  onTerminalExit(callback: (id: number, exitCode: number) => void): void;
  sendTerminalInput(id: number, data: string): void;
  resizeTerminal(id: number, cols: number, rows: number): void;
  killTerminal(id: number): void;
}
