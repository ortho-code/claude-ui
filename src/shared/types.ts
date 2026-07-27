export interface SessionSummary {
  /** Session id, taken from the .jsonl filename. */
  id: string;
  /** First user/assistant message uuid; identifies the conversation (branches share it). */
  conversationId: string;
  /** Absolute working directory the session ran in. */
  cwd: string;
  /** The session's custom or AI-generated title, empty when it has none. */
  title: string;
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
  /** Session ids open as tabs, in order, persisted for restore on next launch. */
  getOpenSessions(): Promise<string[]>;
  setOpenSessions(ids: string[]): void;
  /** Open a folder picker; resolves to the chosen path or null if cancelled. */
  pickFolder(): Promise<string | null>;
  /** Current status per session id (busy | idle | waiting). */
  getAllStatuses(): Promise<Record<string, string>>;
  /** Subscribe to live status changes. `tab` is the spawning terminal's token (may be empty). */
  onSessionStatus(callback: (id: string, status: string, tab: string) => void): void;
  /** Clear a session's status (removes its status file). */
  clearStatus(id: string): void;
  /**
   * Open a terminal in `cwd`: resume `resumeSessionId`, or start a fresh claude when omitted.
   * `tabToken` is echoed back by the status hook so the app can learn a new session's real id.
   * Resolves to a terminal id.
   */
  startTerminal(cwd: string, resumeSessionId?: string, tabToken?: string): Promise<number>;
  onTerminalData(callback: (id: number, data: string) => void): void;
  onTerminalExit(callback: (id: number, exitCode: number) => void): void;
  sendTerminalInput(id: number, data: string): void;
  resizeTerminal(id: number, cols: number, rows: number): void;
  killTerminal(id: number): void;
  /** Close a session, letting claude exit cleanly so it flushes first. */
  closeTerminal(id: number): void;
}
