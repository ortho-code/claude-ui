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
   *  --fork-session). Members are SIBLINGS — no parent/child direction is derived, because fork direction is not reliably recoverable from transcript data. Each sibling renders as its own row. */
  isSibling: boolean;
  /** The other members of this session's family (empty when not a sibling). */
  siblingIds: string[];
  /** First user/assistant uuid after each compaction boundary. A fork of a compacted session adopts
   *  one of these as its own conversationId, which is how such a fork is linked into the family. Main-process bookkeeping; the renderer doesn't use it. */
  postCompactHeads: string[];
}

/**
 * A user-defined group of sessions, shown as a sub-section under its project's heading. Groups are app-side only: nothing about them is written to ~/.claude.
 */
export interface SessionGroup {
  id: string;
  name: string;
  /** The project (repoRoot) the group lives in. Null is reserved for a future cross-project group. */
  repoRoot: string | null;
}

/** Every group and who is in one. Read and returned whole, so the two halves can never disagree. */
/** Where an ordering move sends a group or project: the ends, or one step either way. */
export type OrderMove = 'top' | 'up' | 'down' | 'bottom';

export interface GroupState {
  /** The registry, in display order: a new group is prepended, so it lands at the top of its project. */
  groups: SessionGroup[];
  /** Session id -> group id. A session is in at most one group, so this map IS the membership. */
  groupOf: Record<string, string>;
}

/**
 * How the sidebar was left: what was searched for, what was filtered, what was folded away, how wide it was and how far down it was scrolled.
 *
 * Stored and restored as ONE object rather than as a key each.
 * These are all answers to the same question — "put the sidebar back the way it was" — and they are written together on a debounce from a single snapshot, so a key each would mean ten round trips and ten chances for half of a view to be restored.
 */
export interface UiState {
  /** The search box's contents. */
  search: string;
  /** The filter toggles, named as their buttons are. */
  filters: {
    pinned: boolean;
    open: boolean;
    running: boolean;
    worktree: boolean;
    siblings: boolean;
    noted: boolean;
    archived: boolean;
  };
  /**
   * The active date preset, or 'any' when the date filter is off.
   * A rolling preset ("last 7 days") is recomputed from the current moment on restore, which is what makes it still mean what it said; only 'custom' reads the stored range back.
   */
  datePreset: string;
  /** The custom range, in epoch ms. Only meaningful while `datePreset` is 'custom'. */
  dateFrom: number | null;
  dateTo: number | null;
  /**
   * Whether the filter panel is open, restored exactly as stored — an active filter included.
   * Closing it over a filter left deliberately on is a choice to keep the results and take the space back, so the accent the filter icon carries while anything is on is the cue that the list is cut down.
   */
  filterPanelOpen: boolean;
  /** Folded-away projects, by repo root. */
  collapsedProjects: string[];
  /** Folded-away groups, by group id. */
  collapsedGroups: string[];
  /**
   * The folds made WHILE filtering, which are a separate state from the two above.
   * Filtering opens the whole tree so a match is never hidden, and folding from there is a way through the results rather than a statement about how the sidebar should look — so it applies only while a filter is on, and the moment one stops the pair is emptied.
   * Stored all the same, because the filter itself is restored: coming back to the same results and not the same view would be the very thing this exists to prevent.
   */
  filterCollapsedProjects: string[];
  filterCollapsedGroups: string[];
  /** Sidebar width in px; null until it has been dragged. */
  sidebarWidth: number | null;
  /** How far the session list was scrolled, in px. */
  scrollTop: number;
}

export interface ClaudeUiApi {
  listSessions(): Promise<SessionSummary[]>;
  /** Whether a worktree of this name already exists for the repo (blocks creating a duplicate). */
  worktreeExists(repoRoot: string, name: string): Promise<boolean>;
  /** Fires when a session transcript on disk is created or changes (debounced). */
  onSessionsChanged(callback: () => void): void;
  /** Fires once when the app is shutting down, before its terminals are torn down. */
  onQuitting(callback: () => void): void;
  /** Fires once at startup when the `claude` CLI cannot be found on PATH. */
  onClaudeMissing(callback: () => void): void;
  /** Session ids the user has pinned. */
  getPinned(): Promise<string[]>;
  /** Toggle a session's pin; resolves to the updated pinned list. */
  togglePin(id: string): Promise<string[]>;
  /** Archived session ids mapped to when they were archived (epoch ms; 0 = unknown). */
  getArchived(): Promise<Record<string, number>>;
  /** Toggle a session's archived state; resolves to the updated archived map. */
  toggleArchive(id: string): Promise<Record<string, number>>;
  /**
   * Delete a session: move its transcript file to the trash and drop it from metadata. The renderer confirms first via its own modal.
   */
  deleteSession(id: string): Promise<void>;
  /** Session ids open as tabs, in order, persisted for restore on next launch. */
  getOpenSessions(): Promise<string[]>;
  setOpenSessions(ids: string[]): void;
  /** Which open session to reopen on; null means open on no tab. */
  getActiveSession(): Promise<string | null>;
  /** repoRoot -> the session last looked at there, so switching projects returns you where you were. */
  getActiveSessionByProject(): Promise<Record<string, string>>;
  setActiveSession(id: string | null, repoRoot?: string): void;
  getActiveProject(): Promise<string | null>;
  setActiveProject(folder: string | null): void;
  /** Whether the attention strip starts expanded (true for a meta that never said otherwise). */
  /** Session id -> note text. Only sessions WITH a note appear. */
  getNotes(): Promise<Record<string, string>>;
  /** Write or clear a session's note (blank clears); resolves to the updated map. */
  setNote(id: string, note: string): Promise<Record<string, string>>;
  getFooterExpanded(): Promise<boolean>;
  setFooterExpanded(expanded: boolean): void;
  /** The sidebar's view state — search, filters, folds, width, scroll — as it was last left. */
  getUiState(): Promise<UiState>;
  setUiState(state: UiState): void;
  getProjectNames(): Promise<Record<string, string>>;
  setProjectName(repoRoot: string, name: string): Promise<Record<string, string>>;
  /** Every group plus the session -> group membership. */
  getGroupState(): Promise<GroupState>;
  /**
   * Create a group in a project, optionally moving a session into it in the same step (the row menu's "New group…" does both). A blank name creates nothing.
   */
  createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState>;
  renameGroup(id: string, name: string): Promise<GroupState>;
  /** Delete a group; its members become ungrouped and the sessions themselves are untouched. */
  deleteGroup(id: string): Promise<GroupState>;
  /** Move a session into a group, or out of any group with a null groupId. */
  moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState>;
  /** Reorder a group within its own project. Other projects' groups keep their positions. */
  moveGroup(id: string, move: OrderMove): Promise<GroupState>;
  /** The projects' display order, oldest known first. Empty until the first seed. */
  getProjectOrder(): Promise<string[]>;
  /**
   * Give every one of `roots` a slot, and hand back the resulting order.
   * Unknown roots go to the front (a new project should be noticed); the very first call seeds the order from `roots` as given, so nothing jumps on the run that introduces this.
   */
  seedProjectOrder(roots: string[]): Promise<string[]>;
  /** Reorder one project among the others. */
  moveProject(repoRoot: string, move: OrderMove): Promise<string[]>;
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
   * `worktree` runs `-w` to start in a new git worktree: a non-empty string names it, `''` lets claude auto-name, `undefined` means no worktree.
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
