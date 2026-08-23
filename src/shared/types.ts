export interface SessionSummary {
  /** Session id, taken from the .jsonl filename. */
  id: string;
  /** First user/assistant message uuid; identifies the conversation (branches share it). */
  conversationId: string;
  /** Absolute working directory the session ran in. */
  cwd: string;
  /** Main repo root the session groups under (the cwd itself when not in a git repo). */
  repoRoot: string;
  /** Whether repoRoot is a git repo (so the project can host worktree sessions). */
  isRepo: boolean;
  /** Worktree name when the session ran in a linked git worktree; empty otherwise. */
  worktree: string;
  /** The session's custom or AI-generated title, empty when it has none. */
  title: string;
  /** First user message, trimmed for display. Empty when none was found. */
  firstMessage: string;
  /** Latest model id an assistant message reported (e.g. claude-opus-4-…); empty when unknown. */
  model: string;
  /** Last activity: the timestamp of the last user/assistant message (falls back to file mtime only
   *  when the transcript has no message timestamp). Ignores background/system appends. */
  lastActivity: string;
  /** Number of transcript lines (events) in the session. */
  /** This session belongs to a multi-file family (sessions sharing a conversation, e.g. via
   *  --fork-session). Members are SIBLINGS — no parent/child direction is derived, because fork
   *  direction is not reliably recoverable from transcript data. Each sibling renders as its own row. */
  isSibling: boolean;
  /** The other members of this session's family (empty when not a sibling). */
  siblingIds: string[];
  /** First user/assistant uuid after each compaction boundary. A fork of a compacted session adopts
   *  one of these as its own conversationId, which is how such a fork is linked into the family.
   *  Main-process bookkeeping; the renderer doesn't use it. */
  postCompactHeads: string[];
}

/**
 * A user-defined group of sessions, shown as a sub-section under its project's heading. Groups are
 * app-side only: nothing about them is written to ~/.claude.
 */
export interface SessionGroup {
  id: string;
  name: string;
  /** The project (repoRoot) the group lives in. Null is reserved for a future cross-project group. */
  repoRoot: string | null;
}

/** Every group and who is in one. Read and returned whole, so the two halves can never disagree. */
/** Where an ordering move sends a group: the ends, or one step either way. */
export type GroupMove = 'top' | 'up' | 'down' | 'bottom';

export interface GroupState {
  /** The registry, in display order: a new group is prepended, so it lands at the top of its project. */
  groups: SessionGroup[];
  /** Session id -> group id. A session is in at most one group, so this map IS the membership. */
  groupOf: Record<string, string>;
}

export interface ClaudeUiApi {
  listSessions(): Promise<SessionSummary[]>;
  /** Whether a worktree of this name already exists for the repo (blocks creating a duplicate). */
  worktreeExists(repoRoot: string, name: string): Promise<boolean>;
  /** Fires when a session transcript on disk is created or changes (debounced). */
  onSessionsChanged(callback: () => void): void;
  /** Fires once when the app is shutting down, before its terminals are torn down. */
  onQuitting(callback: () => void): void;
  /** Session ids the user has pinned. */
  getPinned(): Promise<string[]>;
  /** Toggle a session's pin; resolves to the updated pinned list. */
  togglePin(id: string): Promise<string[]>;
  /** Archived session ids mapped to when they were archived (epoch ms; 0 = unknown). */
  getArchived(): Promise<Record<string, number>>;
  /** Toggle a session's archived state; resolves to the updated archived map. */
  toggleArchive(id: string): Promise<Record<string, number>>;
  /**
   * Delete a session: move its transcript file to the trash and drop it from metadata.
   * The renderer confirms first via its own modal.
   */
  deleteSession(id: string): Promise<void>;
  /** Session ids open as tabs, in order, persisted for restore on next launch. */
  getOpenSessions(): Promise<string[]>;
  setOpenSessions(ids: string[]): void;
  getActiveProject(): Promise<string | null>;
  setActiveProject(folder: string | null): void;
  getProjectNames(): Promise<Record<string, string>>;
  setProjectName(repoRoot: string, name: string): Promise<Record<string, string>>;
  /** Every group plus the session -> group membership. */
  getGroupState(): Promise<GroupState>;
  /**
   * Create a group in a project, optionally moving a session into it in the same step (the row
   * menu's "New group…" does both). A blank name creates nothing.
   */
  createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState>;
  renameGroup(id: string, name: string): Promise<GroupState>;
  /** Delete a group; its members become ungrouped and the sessions themselves are untouched. */
  deleteGroup(id: string): Promise<GroupState>;
  /** Move a session into a group, or out of any group with a null groupId. */
  moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState>;
  /** Reorder a group within its own project. Other projects' groups keep their positions. */
  moveGroup(id: string, move: GroupMove): Promise<GroupState>;
  /** Open a folder picker; resolves to the chosen path or null if cancelled. */
  pickFolder(): Promise<string | null>;
  /** Open an http(s) URL in the OS default browser (non-http schemes are ignored). */
  openExternal(url: string): void;
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
  /**
   * `fork` runs `--fork-session` (copies the resumed session into a new fork; needs resumeSessionId).
   * `name` runs `--name` to set the session's display name (claude records it as a custom-title).
   * `worktree` runs `-w` to start in a new git worktree: a non-empty string names it, `''` lets
   * claude auto-name, `undefined` means no worktree.
   */
  startTerminal(
    cwd: string,
    resumeSessionId?: string,
    tabToken?: string,
    fork?: boolean,
    name?: string,
    worktree?: string,
  ): Promise<number>;
  onTerminalData(callback: (id: number, data: string) => void): void;
  onTerminalExit(callback: (id: number, exitCode: number) => void): void;
  sendTerminalInput(id: number, data: string): void;
  resizeTerminal(id: number, cols: number, rows: number): void;
  killTerminal(id: number): void;
  /** Close a session, letting claude exit cleanly so it flushes first. */
  closeTerminal(id: number): void;
}
