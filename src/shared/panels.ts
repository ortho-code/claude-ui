/**
 * Panels: the layout file's shape, what main reports about one read of it, and how a `command` panel's run reaches the renderer.
 *
 * The layout file is hand-edited, and that decides two things here.
 * Its shape is ONE TREE for the whole window — rows, columns and groups of panels — in which the app's own surfaces (the sidebar, the terminal area) are panels like any other.
 * And nothing in it is trusted at the type level: main hands the parsed JSON over as `unknown`, and the renderer's validator names every mistake in its place rather than dropping it — a person wrote the file, so a silent drop would be a lie about what they wrote.
 */

/**
 * The layout file's `version`. The one shape this build reads; anything else renders a degraded group saying so.
 * Version 1 (`sides.right.groups[].panels[]`) is replaced rather than converted: it had one user, and the validator's "version 1 is not one this build reads" is its migration notice.
 */
export const LAYOUT_VERSION = 2;

/**
 * One panel, as an entry in the layout file.
 * Everything but `options` is the LAYOUT's: `id` is a slug the user writes (`^[a-z0-9][a-z0-9_-]*$`), unique across the whole file — nodes and entries share one namespace — and what panel state keys on; `title`, `hidden` and `icon` are how the layout draws it.
 * `options` is the PANEL's, handed to its type whole and read by nobody else: the type declares what it takes (`renderer/panels/types/*`) and says itself what is wrong with it, so a type can gain a setting without the layout learning its name.
 */
export interface PanelEntry {
  id: string;
  type: string;
  title?: string;
  hidden?: boolean;
  /** The panel's icon on a rail, by name from the app's set; the type's own when absent. */
  icon?: string;
  /** The type's own settings, as written. */
  options?: Record<string, unknown>;
}

/** What every node in the tree may say about itself, whatever it holds. */
interface LayoutNodeBase {
  /** A slug, unique across nodes and entries: what sizes, collapse and the shown tab key on. */
  id: string;
  /**
   * A number is a SHARE of the parent's axis, any positive number; siblings without one share what the shares leave equally.
   * `"320px"` is PIXELS: the node keeps that size when the window resizes, and the shares divide what is left.
   * Read only while no dragged size is stored for every sibling.
   */
  size?: number | `${number}px`;
  /** In px along the parent's axis; 120 when absent. */
  min?: number;
  /** False removes the dividers on this node's edges, so it keeps its share. True when absent. */
  resizable?: boolean;
  /** Whether a group can fold to a rail. False when absent; honoured on groups only in this build. */
  collapsible?: boolean;
}

/**
 * One node of the layout: exactly one of `rows`, `columns` or `panels`.
 * A node with `panels` is a GROUP, which shows one panel at a time; `active` names the one shown until the user picks another.
 */
export type LayoutNode =
  | (LayoutNodeBase & { rows: LayoutNode[] })
  | (LayoutNodeBase & { columns: LayoutNode[] })
  | (LayoutNodeBase & { panels: PanelEntry[]; active?: string });

/** A layout file as this build reads it. */
export interface Layout {
  version: typeof LAYOUT_VERSION;
  root: LayoutNode;
}

/**
 * Where the tree was left, per machine, in `UiState` — never in the layout file, which is what may be shared.
 * Everything keys on the file's ids, so an edit that renames a node starts it fresh rather than handing it another node's state.
 */
export interface PanelState {
  /**
   * Dragged sizes in px, per split id, per child id.
   * A split's entry is honoured only while it names EVERY current child, so a file edit that adds or removes a child falls back to the file's sizes rather than half of each.
   */
  sizes: Record<string, Record<string, number>>;
  /** Groups folded to their rail, by id. */
  collapsed: string[];
  /** The shown panel per group id, by entry id; the file's `active` is the default. */
  active: Record<string, string>;
}

/** What a relative path option resolves against: the config folder, or a directory the panel names. */
export type PathBase = 'config' | { dir: string };

/** What a path option must point at. */
export type PathKind = 'executable' | 'directory';

/** How one path option checked out. Main's, because main has the filesystem; asked by the panel whose option it is. */
export interface PathCheck {
  /** The absolute path the value resolved to. */
  path: string;
  /** What is wrong with it, as a sentence naming the value as written, or null when it is there and of the kind asked for. */
  problem: string | null;
}

/**
 * One read of the layout file, before any validation of its shape.
 *
 * `missing`: there is no file, so there is no layout. `unparsable`: the file is there and could not be used, and `error` says why and where — the renderer keeps the last good layout up. `read`: `json` holds whatever the file parsed to.
 * Nothing a panel's options point at is checked here: that is the panel's to ask about, when it is mounted and before it runs.
 */
export interface LayoutReport {
  configRoot: string;
  file: string;
  status: 'missing' | 'unparsable' | 'read';
  error: string | null;
  json: unknown;
}

/** What a `command` panel runs: exactly one of the two, as its options gave it. */
export type PanelSource = { command: string } | { script: string };

/**
 * Where a run happens, and the flat fields the command gets in its environment as `CLAUDE_UI_*`.
 * Environment only for now; the JSON on stdin joins when a second type wants it.
 */
export interface PanelContext {
  /** The selected project's repo root. */
  projectRoot: string;
  /** The directory the command runs in: the active tab's cwd, else the project root, so a worktree session's panel reports the worktree. */
  cwd: string;
  /** The active tab's session, or '' without one. */
  sessionId: string;
}

export interface PanelRunRequest {
  entryId: string;
  /**
   * The renderer's own token for this run, carried back on every event.
   * A re-run stops the run before it, but output already on its way is not recalled, so the token is how the renderer tells a superseded run's tail from the new run's start.
   */
  token: string;
  source: PanelSource;
  context: PanelContext;
}

/** Why the app ended a run, as opposed to the run ending on its own. */
export type PanelStopReason = 'timeout' | 'truncated' | 'rerun' | 'request' | 'quit';

/**
 * What a run sends the renderer, in order: any number of `output`, at most one `truncated`, then exactly one of `exit` (it ended by itself, or never started) or `stopped` (the app ended it).
 */
export type PanelRunEvent =
  | { kind: 'output'; text: string }
  /** The cap was reached: nothing after this is forwarded, and the process is being stopped. */
  | { kind: 'truncated' }
  | { kind: 'exit'; code: number | null; signal: string | null; error?: string }
  | { kind: 'stopped'; reason: PanelStopReason };

/** Output beyond this is cut and the process stopped: a panel shows a result, not a log. */
export const PANEL_OUTPUT_CAP = 1024 * 1024;

/** A run still going after this is stopped: a process that never exits by design is not this panel type. */
export const PANEL_TIMEOUT_MS = 30_000;
