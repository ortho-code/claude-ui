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
  /** Worktree name when the session's transcript last puts it in a linked git worktree; empty otherwise. */
  worktree: string;
  /**
   * Worktree name when the session ran in a linked git worktree and has since left it; empty otherwise, and always empty while `worktree` is set.
   * Only a worktree Claude Code recorded the session entering counts: a Bash `cd` into one moves the cwd its records carry, and nothing else.
   * Named as `worktree` is, so a removed tree goes unnamed unless it sat under `.claude/worktrees/`.
   */
  leftWorktree: string;
  /** The session's custom or AI-generated title, empty when it has none. */
  title: string;
  /**
   * First user message, trimmed for display.
   * Empty when none was found.
   */
  firstMessage: string;
  /** Latest model id an assistant message reported (e.g. claude-opus-4-…); empty when unknown. */
  model: string;
  /**
   * Last activity: the timestamp of the last user/assistant message (falls back to file mtime only when the transcript has no message timestamp).
   * Ignores background/system appends.
   */
  lastActivity: string;
  /**
   * This session belongs to a multi-file family (sessions sharing a conversation, e.g. via --fork-session).
   * Members are SIBLINGS — no parent/child direction is derived, because fork direction is not reliably recoverable from transcript data.
   * Each sibling renders as its own row.
   */
  isSibling: boolean;
  /** The other members of this session's family (empty when not a sibling). */
  siblingIds: string[];
  /**
   * First user/assistant uuid after each compaction boundary.
   * A fork of a compacted session adopts one of these as its own conversationId, which is how such a fork is linked into the family.
   * Main-process bookkeeping; the renderer doesn't use it.
   */
  postCompactHeads: string[];
  /**
   * Whether `cwd` is still a directory.
   * A session cannot run anywhere else, so false refuses everything that would start one.
   */
  cwdExists: boolean;
  /**
   * Whether `repoRoot` is still a directory.
   * Separate from `cwdExists` on purpose: a removed worktree leaves its repo perfectly fine, and a removed repo takes its worktrees with it.
   */
  repoRootExists: boolean;
}

/**
 * One request in a session and what claude sent back, read from the session's transcript (`src/main/transcript.ts`).
 * Only the LAST exchange of a session ever changes, and only by growing: claude's reply to it is still being written.
 * The one exception is a rewind, which marks the requests it went back past.
 */
export interface Exchange {
  /** The request record's uuid: what a pin keys on, and the same in both transcripts of a fork. */
  id: string;
  /** When the request was sent, as the transcript records it (ISO). */
  time: string;
  /** What was asked, as it was typed; a slash command as its command line ("/review https://…"). */
  request: string;
  /** Typed at the prompt, a slash command claude answered, or sent while claude was still working on something else. */
  kind: 'typed' | 'command' | 'busy';
  /**
   * The next request replaced this one: it has the same parent in the transcript's tree, which is what stopping claude and sending again, or editing and resending, leaves behind.
   * Shown, dimmed, rather than hidden, so a stopped attempt's partial reply and any pin on it stay.
   */
  replaced: boolean;
  /**
   * Gone back past with claude's rewind: a later request carries on from before this one, and every request in between followed on from it, so claude's conversation no longer has any of them.
   * Shown, dimmed, as a request sent again is, and for the same reasons.
   */
  rewound: boolean;
  /** Claude's reply, piece by piece in the order it was written: its messages, and the tool calls between them. */
  parts: ReplyPart[];
}

/**
 * One piece of a reply: a message from claude (markdown), or a tool call — the tool's name and, on one line, the input that says what it acted on (empty when none does).
 * A message carries an id, its assistant record's uuid and its place among that record's messages, which is what a pin on it keys on and which a fork copies too.
 */
export type ReplyPart = { kind: 'text'; id: string; time: string; text: string } | { kind: 'tool'; name: string; detail: string };

/**
 * A request or one of claude's messages, pinned in the history and stored in meta.json under its id (`Exchange.id`, or a message's `id`).
 * Keyed by what was pinned rather than by the session, so it outlives the process and shows in both siblings of a fork; it carries enough to be listed without opening its transcript.
 */
export interface HistoryPin {
  kind: 'request' | 'reply';
  /** The session it was pinned in. */
  session: string;
  /** Its opening text, cut to a few hundred characters when it is pinned (`meta.ts`). */
  text: string;
  /** When it was written (ISO), as its transcript records it. */
  time: string;
  /** When it was pinned (epoch ms). */
  pinnedAt: number;
}

/**
 * What a history read hands back: the exchanges from `from` on, which replace whatever the caller held from that index.
 * A `generation` other than the one the caller passed means the transcript was read again from the start (it shrank), so nothing the caller held is still good.
 */
export interface HistorySlice {
  generation: number;
  from: number;
  exchanges: Exchange[];
  total: number;
}

/**
 * What the renderer asks for when it opens a terminal, beyond the flags every session gets.
 *
 * The app MINTS the session id (`sessionId`) and hands it to claude, rather than letting claude pick one and then finding out which: a tab therefore knows its own session from the first paint, and every id-keyed thing — the sidebar row, a group, a pin, a note, the status files — lands on the right session immediately.
 * `resumeSessionId` is the opposite direction: a session that already has a transcript.
 * The two meet only in a fork, which resumes the parent and writes a new session under the minted id.
 */
export interface TerminalLaunch {
  /**
   * `--session-id`: the id to create the session under.
   * Omitted when resuming, where the id already exists.
   */
  sessionId?: string;
  /**
   * `--resume`: the session to continue.
   * For a fork this is the PARENT — the new session lands on `sessionId`.
   */
  resumeSessionId?: string;
  /**
   * `--fork-session`: copy the resumed transcript into a new session instead of continuing it.
   * Needs both ids.
   */
  fork?: boolean;
  /** `--name`: the session's display name (claude records it as a custom-title). */
  name?: string;
  /** `-w`: start in a new git worktree — a non-empty string names it, `''` lets claude auto-name, `undefined` means no worktree. */
  worktree?: string;
  /** The session's first prompt, which claude runs as soon as it starts: a slash command such as `/review 35743` runs as one. */
  prompt?: string;
  /**
   * Not a claude flag: an environment marker naming the TAB, echoed back by the status hook.
   * `sessionId` settles which session a terminal starts with; this is what keeps the answer right afterwards, since `/clear` replaces the session with one the app did not name.
   */
  tabToken?: string;
}

/**
 * A user-defined group of sessions, shown as a sub-section under its project's heading.
 * Groups are app-side only: nothing about them is written to ~/.claude.
 */
export interface SessionGroup {
  id: string;
  name: string;
  /**
   * The project (repoRoot) the group lives in.
   * Null is reserved for a future cross-project group.
   */
  repoRoot: string | null;
}

/** Where an ordering move sends a group or project: the ends, or one step either way. */
export type OrderMove = 'top' | 'up' | 'down' | 'bottom';

/**
 * Every group and who is in one.
 * Read and returned whole, so the two halves can never disagree.
 */
export interface GroupState {
  /** The registry, in display order: a new group is prepended, so it lands at the top of its project. */
  groups: SessionGroup[];
  /**
   * Session id -> group id.
   * A session is in at most one group, so this map IS the membership.
   */
  groupOf: Record<string, string>;
}

/**
 * How the sidebar was left: what was searched for, what was filtered, what was folded away, how wide it was and how far down it was scrolled.
 *
 * Stored and restored as ONE object rather than as a key each.
 * These are all answers to the same question — "put the sidebar back the way it was" — and they are written together on a debounce from a single snapshot, so a key each would mean ten round trips and ten chances for half of a view to be restored.
 */
/** What the renderer needs to know about who draws the window's chrome. */
export interface WindowChrome {
  /**
   * True where the window is frameless and the app draws its own title bar.
   * False on macOS, which keeps its traffic lights.
   */
  own: boolean;
  maximized: boolean;
  /**
   * The full window title, for the bar's tooltip.
   * The renderer cannot read it: `setTitle` from the main process does not touch `document.title`.
   */
  title: string;
  version: string;
  /**
   * A run from source rather than the installed app.
   * Worth showing, since the two are otherwise identical down to the data directory.
   */
  dev: boolean;
}

/**
 * Deliberate preferences, kept apart from UiState on purpose: in the config folder, in your `settings.json` and the app's `settings.local.json` (shared/settings.ts).
 *
 * UiState is where you LEFT the app — which project, which folds, how far down the list.
 * This is what you CHOSE, and the two are separated so that a future "reset settings" cannot throw away your place in the app, and so that clearing your place cannot silently undo a choice.
 */
export interface Settings {
  /**
   * Flags added to every `claude` the app launches, as one line the way you would type it.
   * Stored as text rather than as parsed tokens so the field shows exactly what was entered; it is parsed at launch (and validated before it can be saved).
   */
  launchFlags: string;
}

export interface UiState {
  /** The search box's contents. */
  search: string;
  /** The filter toggles, named as their buttons are. */
  filters: {
    pinned: boolean;
    open: boolean;
    live: boolean;
    worktree: boolean;
    /** Sessions whose folder is gone. */
    gone: boolean;
    siblings: boolean;
    noted: boolean;
    archived: boolean;
  };
  /**
   * The active date preset, or 'any' when the date filter is off.
   * A rolling preset ("last 7 days") is recomputed from the current moment on restore, which is what makes it still mean what it said; only 'custom' reads the stored range back.
   */
  datePreset: string;
  /**
   * The custom range, in epoch ms.
   * Only meaningful while `datePreset` is 'custom'.
   */
  dateFrom: number | null;
  dateTo: number | null;
  /**
   * Whether the filter panel is open, restored exactly as stored — an active filter included.
   * Closing it over a filter left deliberately on is a choice to keep the results and take the space back, so a shut panel folds down to a row of chips naming what is on, above the count, and the filter icon carries its accent.
   */
  filterPanelOpen: boolean;
  /**
   * Whether the live strip at the foot of the sidebar is expanded.
   * Open by default — it is meant to be read.
   */
  stripExpanded: boolean;
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
  /** Where the layout tree was left: dragged sizes, folded groups, shown tabs. */
  panelState: PanelState;
}

import type { LayoutReport, NodeState, NodeStateChange, PanelContext, PanelData, PanelLink, PanelRunEvent, PanelRunRequest, PanelState, PathBase, PathCheck, PathKind } from './panels';
import type { FolderName } from './folders';
import type { LogLevel } from './log';
import type { SettingsChange, SettingsSaved, SettingsView } from './settings';

export interface ClaudeUiApi {
  listSessions(): Promise<SessionSummary[]>;
  /**
   * Session `id`'s requests and replies, for a caller that holds `known` exchanges of `generation` (0 and 0 the first time).
   * The first call reads the whole transcript and later ones only what was appended; see HistorySlice for how to apply the answer.
   */
  getHistory(id: string, known: number, generation: number): Promise<HistorySlice>;
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
  /** Requests and messages pinned in any session's history, by their ids. */
  getHistoryPins(): Promise<Record<string, HistoryPin>>;
  /** Pin request or message `id` with what a list of pins shows of it, or unpin it; returns every history pin after the change. */
  toggleHistoryPin(id: string, pin: Pick<HistoryPin, 'kind' | 'session' | 'text' | 'time'>): Promise<Record<string, HistoryPin>>;
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
  /** Which open session to reopen on; null means open on no tab. */
  getActiveSession(): Promise<string | null>;
  /** repoRoot -> the session last looked at there, so switching projects returns you where you were. */
  getActiveSessionByProject(): Promise<Record<string, string>>;
  setActiveSession(id: string | null, repoRoot?: string): void;
  getActiveProject(): Promise<string | null>;
  setActiveProject(folder: string | null): void;
  /**
   * Session id -> note text.
   * Only sessions WITH a note appear.
   */
  getNotes(): Promise<Record<string, string>>;
  /** Write or clear a session's note (blank clears); resolves to the updated map. */
  setNote(id: string, note: string): Promise<Record<string, string>>;
  /** The sidebar's view state — search, filters, folds, width, scroll — as it was last left. */
  getUiState(): Promise<UiState>;
  setUiState(state: UiState): void;
  /** The app's preferences: each one in force, where it came from, and what is wrong with either file (shared/settings.ts). */
  getSettings(): Promise<SettingsView>;
  /**
   * Change the app's preferences, in the app's own `settings.local.json`; resolves to the settings as they then stand.
   * Validated here as well as in the dialog: the main process is what hands the flags to a session, so it is what has to be sure of them.
   * Refused, saying why in `refused`, when a value is not one the setting may hold, or when the app's file does not parse, since the app will not write over it.
   */
  setSettings(change: SettingsChange): Promise<SettingsSaved>;
  /** Fires with the settings as they now stand when either settings file changed, other than by the app's own write. */
  onSettingsChanged(callback: (view: SettingsView) => void): void;
  /**
   * Whether this window has no OS title bar, so the renderer has to draw one, plus the current maximized state.
   * Asked once at startup: it is decided by the platform and cannot change while the app runs.
   */
  getWindowChrome(): Promise<WindowChrome>;
  minimizeWindow(): void;
  toggleMaximizeWindow(): void;
  closeWindow(): void;
  /**
   * Begin a window gesture: an edge or corner ('n', 'se', …) to resize, or 'move' to drag the window.
   * Moving is ours rather than a drag region because a drag region brings Chromium's own double-click-to-maximize, which cannot be suppressed.
   * See docs/architecture.md § The window's own chrome.
   */
  startWindowResize(edge: string, pointer?: { x: number; y: number }): void;
  /** Offset of the gesture from where it started — total, not incremental. */
  resizeWindowBy(dx: number, dy: number): void;
  endWindowResize(): void;
  /** Fires when the window is maximized or restored, including when a window manager did it. */
  onWindowMaximized(handler: (maximized: boolean) => void): void;
  getProjectNames(): Promise<Record<string, string>>;
  setProjectName(repoRoot: string, name: string): Promise<Record<string, string>>;
  /** Every group plus the session -> group membership. */
  getGroupState(): Promise<GroupState>;
  /**
   * Create a group in a project, optionally moving a session into it in the same step (the row menu's "New group…" does both).
   * A blank name creates nothing.
   */
  createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState>;
  renameGroup(id: string, name: string): Promise<GroupState>;
  /** Delete a group; its members become ungrouped and the sessions themselves are untouched. */
  deleteGroup(id: string): Promise<GroupState>;
  /** Move a session into a group, or out of any group with a null groupId. */
  moveSessionToGroup(sessionId: string, groupId: string | null): Promise<GroupState>;
  /**
   * Reorder a group within its own project.
   * Other projects' groups keep their positions.
   */
  moveGroup(id: string, move: OrderMove): Promise<GroupState>;
  /**
   * The projects' display order, oldest known first.
   * Empty until the first seed.
   */
  getProjectOrder(): Promise<string[]>;
  /**
   * Give every one of `roots` a slot, and hand back the resulting order.
   * Unknown roots go to the front (a new project should be noticed); the very first call seeds the order from `roots` as given, so nothing jumps on the run that introduces this.
   */
  seedProjectOrder(roots: string[]): Promise<string[]>;
  /** Reorder one project among the others. */
  moveProject(repoRoot: string, move: OrderMove): Promise<string[]>;
  /**
   * Note, for the record, that `/clear` replaced session `from` with session `to`.
   * Data collection: nothing reads it back.
   * The app is the only thing that can observe the two are connected, and only at the moment it happens.
   */
  recordClear(from: string, to: string, title: string): Promise<void>;
  /** Open a folder picker; resolves to the chosen path or null if cancelled. */
  pickFolder(): Promise<string | null>;
  /** Open an http(s) URL in the OS default browser (non-http schemes are ignored). */
  openExternal(url: string): void;
  /** Current status per session id (busy | idle | waiting). */
  getAllStatuses(): Promise<Record<string, string>>;
  /**
   * Subscribe to live status changes.
   * `tab` is the reporting terminal's token (empty for a session claude-ui is not running), and `event` the hook event that reported it (empty from a file written before the hook named it).
   */
  onSessionStatus(callback: (id: string, status: string, tab: string, event: string) => void): void;
  /**
   * Subscribe to a session changing model.
   * Only a live switch arrives here; a session's model at rest comes from its transcript, which records which model answered.
   */
  onSessionModel(callback: (id: string, model: string) => void): void;
  /** Clear a session's status (removes its status file). */
  clearStatus(id: string): void;
  /**
   * Open a terminal in `cwd` running claude as `launch` describes.
   * Resolves to a terminal id.
   */
  startTerminal(cwd: string, launch: TerminalLaunch): Promise<number>;
  /**
   * Open a plain login shell in `cwd` for a terminal panel, with the context in its environment.
   * Same terminal id space, same data, exit, input and stop calls.
   */
  startShell(cwd: string, context: PanelContext): Promise<number>;
  onTerminalData(callback: (id: number, data: string) => void): void;
  onTerminalExit(callback: (id: number, exitCode: number) => void): void;
  sendTerminalInput(id: number, data: string): void;
  resizeTerminal(id: number, cols: number, rows: number): void;
  /** End a session or a shell outright: `SIGTERM` to its group, `SIGKILL` if it is still there after the grace period. */
  killTerminal(id: number): void;
  /**
   * Ask claude to leave through its own exit, Ctrl-C twice, and three times when `interrupt` says it is mid-turn.
   * Nothing follows it: claude may ask something on its way out and wait for the answer, so a session that has not gone is ended with `killTerminal`.
   */
  closeTerminal(id: number, interrupt: boolean): void;
  /**
   * The layout file as main last read it.
   * Validated in the renderer (panels/layout.ts).
   */
  getLayout(): Promise<LayoutReport>;
  /** Resolve a panel's path option against `base` and check it is what it `must` be; the run and the shell start resolve the same way. */
  checkPath(value: string, base: PathBase, must: PathKind): Promise<PathCheck>;
  /** Fires with a fresh report whenever anything in the config folder changes (debounced). */
  onLayoutChanged(callback: (report: LayoutReport) => void): void;
  /**
   * Keep what changed in the window — a size dragged to, a fold, a panel picked — in the app's file beside the layout, by node id.
   * Refused, saying why in `refused`, for a change that is not one a node can carry, or when that file does not parse, since the app will not write over it.
   */
  setLayoutState(changes: NodeStateChange[]): Promise<{ refused: string | null }>;
  /** Move the tree's state from before the config folder into the app's file beside the layout, once; the window works out what it was, since only it has the tree. */
  moveLayoutState(nodes: Record<string, NodeState>): Promise<{ refused: string | null }>;
  /**
   * Run a `command` panel's command in its context; a run already going for the entry is stopped first.
   * Output arrives through `onPanelRun`.
   */
  runPanel(request: PanelRunRequest): void;
  /** Stop an entry's run, because its panel was hidden or removed. */
  stopPanel(entryId: string): void;
  /**
   * Subscribe to every run's events.
   * `token` is the one the run was requested with, so a superseded run's tail can be told apart.
   */
  onPanelRun(callback: (entryId: string, token: string, event: PanelRunEvent) => void): void;
  /** What the app keeps for a panel: the sessions its rows started, and the group last picked for one. */
  getPanelData(entryId: string): Promise<PanelData>;
  /** Remember a session a panel's row is starting, and the group it was filed in; answers with the panel's data as written. */
  linkPanelSession(entryId: string, sessionId: string, link: Omit<PanelLink, 'startedAt'>, filed: { repoRoot: string; groupId: string | null }): Promise<PanelData>;
  /** Fires when a panel's data changed: a session linked, or one forgotten because it is gone. */
  onPanelDataChanged(callback: (entryId: string, data: PanelData) => void): void;
  /** Where each of the app's own folders is, for Settings to show. */
  getFolders(): Promise<Record<FolderName, string>>;
  /** Open one of the app's own folders in the OS file manager, by name; the window never sends a path. */
  openFolder(name: FolderName): void;
  /**
   * Write a line of the window's own to the app's log.
   * `area` is a short lowercase word; main checks both and cuts a long line.
   */
  log(level: LogLevel, area: string, message: string): void;
}
