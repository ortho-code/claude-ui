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
  /** Spawn a login shell in `cwd`; resolves to a terminal id. */
  startTerminal(cwd: string): Promise<number>;
  onTerminalData(callback: (id: number, data: string) => void): void;
  onTerminalExit(callback: (id: number, exitCode: number) => void): void;
  sendTerminalInput(id: number, data: string): void;
  resizeTerminal(id: number, cols: number, rows: number): void;
  killTerminal(id: number): void;
}
