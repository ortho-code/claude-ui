/**
 * Panels: the layout file's shape, what main reports about one read of it, and how a `command` panel's run reaches the renderer.
 *
 * The layout file is hand-edited, and that decides two things here.
 * Its shape is ONE TREE for the whole window — rows, columns and groups of panels — in which the app's own surfaces (the sidebar, the terminal area) are panels like any other.
 * And nothing in it is trusted at the type level: main hands the parsed JSON over as `unknown`, and the renderer's validator names every mistake in its place rather than dropping it — a person wrote the file, so a silent drop would be a lie about what they wrote.
 */

/**
 * A node's or an entry's id: a slug, lowercase letters, digits, hyphens and underscores, not starting with a hyphen or underscore.
 * What panel state keys on.
 * Here rather than with the layout's other rules because main holds to it too: a panel's own data file is named after its entry's id.
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * The layout file's `version`.
 * The one shape this build reads; anything else renders a degraded group saying so.
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
   * A size dragged to on this machine wins over it (`NodeState`) until a double-click on the divider.
   */
  size?: number | `${number}px`;
  /** In px along the parent's axis; 120 when absent. */
  min?: number;
  /**
   * False removes the dividers on this node's edges, so it keeps its share.
   * True when absent.
   */
  resizable?: boolean;
  /**
   * Whether a group can fold to a rail.
   * False when absent; honoured on groups only in this build.
   */
  collapsible?: boolean;
  /**
   * Whether a group that can fold starts folded, until it is unfolded.
   * False when absent.
   */
  folded?: boolean;
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

/** A node's size as the file gives it: a share of the parent's axis, or pixels that hold when the window resizes. */
export type NodeSize = { share: number } | { px: number };

const PX = /^(\d+(?:\.\d+)?)px$/;

/** A positive number is a share, `"<n>px"` is pixels; anything else is not a size: read the same in your layout file, in the app's beside it, and in what the window asks main to write. */
export function parseSize(value: unknown): NodeSize | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return { share: value };
  const match = typeof value === 'string' ? PX.exec(value) : null;
  const px = match ? Number(match[1]) : 0;
  return px > 0 ? { px } : null;
}

/** A size as the layout file spells it. */
export function spelledSize(size: NodeSize): number | `${number}px` {
  return 'px' in size ? `${size.px}px` : size.share;
}

/**
 * What the app keeps for one node of a layout, in the layout's own field names, in the app's file beside it (`layouts/default.local.json`): this machine's sizes, folds and the panel picked in a group, each winning over the field of that name in your layout file (docs/architecture.md § Panel state).
 * Every field is one your layout file can carry too, so keeping one for good is moving it there.
 */
export interface NodeState {
  size?: number | `${number}px`;
  folded?: boolean;
  active?: string;
}

export type NodeStateField = keyof NodeState;
export const NODE_STATE_FIELDS: NodeStateField[] = ['size', 'folded', 'active'];

/** One change the window asks of the app's layout file: a node's field set, or removed with null. */
export interface NodeStateChange {
  id: string;
  field: NodeStateField;
  value: NodeState[NodeStateField] | null;
}

/** What is wrong with `value` as a node's `field`, or null when it may be one; checked in the app's file as read and in every change asked of it. */
export function nodeStateProblem(field: NodeStateField, value: unknown): string | null {
  if (field === 'size') return parseSize(value) ? null : 'size is not a positive number or a pixel size like "320px".';
  if (field === 'folded') return typeof value === 'boolean' ? null : 'folded is not true or false.';
  return typeof value === 'string' && ID_PATTERN.test(value) ? null : 'active is not the id of a panel.';
}

/** The nodes after `changes`, in order: each field set or removed, and a node left with nothing removed whole, so the file keeps only what is kept. */
export function withNodeChanges(nodes: Record<string, NodeState>, changes: NodeStateChange[]): Record<string, NodeState> {
  const next: Record<string, NodeState> = Object.fromEntries(Object.entries(nodes).map(([id, state]) => [id, { ...state }]));
  for (const { id, field, value } of changes) {
    const state: Record<string, unknown> = { ...next[id] };
    if (value === null) delete state[field];
    else state[field] = value;
    if (Object.keys(state).length === 0) delete next[id];
    else next[id] = state;
  }
  return next;
}

/** The app's file beside the layout as main read it, with what the window needs to know about where it came from. */
export interface LocalLayoutRead {
  file: string;
  status: ReadStatus;
  error: string | null;
  json: unknown;
  /** Its text is what the app itself last wrote to it this run, so the window's own state is as new or newer and the read changes nothing it has. */
  byApp: boolean;
  /** Whether the tree's state from before the config folder has moved here from `meta.json`; until it has, the window moves it on its first read. */
  stateMoved: boolean;
}

/**
 * Where the tree was left, per machine, in `UiState`: kept there before it moved into the layout's `.local.json` (`NodeState`), and read now only to move it.
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

/**
 * How one path option checked out.
 * Main's, because main has the filesystem; asked by the panel whose option it is.
 */
export interface PathCheck {
  /** The absolute path the value resolved to. */
  path: string;
  /** What is wrong with it, as a sentence naming the value as written, or null when it is there and of the kind asked for. */
  problem: string | null;
}

/** How one read of a hand-written file in the config folder went: not there, there and not parsed (`error` says what is wrong and where), or read (`json` is what it parsed to). */
export type ReadStatus = 'missing' | 'unparsable' | 'read';

/**
 * One folder under the config folder's `types/`: a panel type of a person's own, which the layout file uses by the folder's name.
 * Read and not judged, like the layout file: `missing` is a folder without a `panel.json`, and what is wrong inside one is the renderer's to say.
 */
export interface TypeReport {
  /** The folder's name, which is the type's name. */
  name: string;
  /** The folder, absolute: what the manifest's `run` resolves against. */
  dir: string;
  status: ReadStatus;
  error: string | null;
  json: unknown;
}

/**
 * One read of the layout file and of the type folders beside it, before any validation of their shape.
 *
 * `missing`: there is no file, so there is no layout.
 * `unparsable`: the file is there and could not be used, and `error` says why and where — the renderer keeps the last good layout up.
 * `read`: `json` holds whatever the file parsed to.
 * Read together so the renderer resolves the layout knowing every type at once, and never shows an entry of a type from the folder as unknown for the moment between two reads.
 * Nothing a panel's options point at is checked here: that is the panel's to ask about, when it is mounted and before it runs.
 */
export interface LayoutReport {
  configRoot: string;
  file: string;
  status: ReadStatus;
  error: string | null;
  json: unknown;
  /** Every folder under `types/`, by name; empty when there is none. */
  types: TypeReport[];
  /** The app's file beside the layout, read with it so the window never draws one without the other. */
  local: LocalLayoutRead;
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

/**
 * Where a run's stderr goes.
 * `merged`: into its output, in true arrival order, for a panel that shows what was printed.
 * `apart`: as `stderr` events of its own, for a panel that parses its stdout, which must then be the result and nothing else.
 */
export type PanelStderr = 'merged' | 'apart';

/**
 * What an option a type's manifest declares may be called: the script gets it as `CLAUDE_UI_OPTION_<NAME>`, so the name has to make a variable's.
 * Here rather than with the manifest's other rules, since main holds to it too when it builds the environment.
 */
export const OPTION_NAME = /^[a-z][a-z0-9_]*$/;

export interface PanelRunRequest {
  entryId: string;
  stderr: PanelStderr;
  /** A type from the config folder's options as the entry gives them, by declared name: each reaches the run as `CLAUDE_UI_OPTION_<NAME>`. */
  options?: Record<string, string>;
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
 * What a run sends the renderer, in order: any number of `output` (and, in an `apart` run, `stderr`), at most one `truncated`, then exactly one of `exit` (it ended by itself, or never started) or `stopped` (the app ended it).
 */
export type PanelRunEvent =
  | { kind: 'output'; text: string }
  /** Only in an `apart` run: what the command wrote on stderr. In order among themselves, but not against `output`, since the two arrive on pipes of their own. */
  | { kind: 'stderr'; text: string }
  /** The cap was reached: nothing after this is forwarded, and the process is being stopped. */
  | { kind: 'truncated' }
  | { kind: 'exit'; code: number | null; signal: string | null; error?: string }
  | { kind: 'stopped'; reason: PanelStopReason };

/**
 * A session a panel's row started, as that panel remembers it: which item it was about, what to call it, and where the item's link goes.
 * Written by the APP when the session starts, never by the panel's script, which never learns a session id.
 */
export interface PanelLink {
  /** The item's `key`, as the list gave it. */
  key: string;
  /** The item's text when the session started. */
  label: string;
  href: string | null;
  /** When the session started, as an ISO time, for which of several is the latest. */
  startedAt: string;
}

/**
 * What the app keeps for one panel, per machine, in a file of that panel's own (`panel-data/<entry id>.json`): never in `meta.json`, so a panel's data cannot damage the app's, and never in the config folder, which is shared while a session id means something only on this machine.
 */
export interface PanelData {
  /** Session id -> the item it was started from. */
  sessions: Record<string, PanelLink>;
  /** Project (repo root) -> the group last picked for a session started from this panel there, or null for none. */
  lastGroup: Record<string, string | null>;
}

/**
 * A panel's data with a session started from one of its items: the link, from `startedAt`, and the group it was filed in there, which the next start from this panel in that project offers first.
 * Main's rule, pure, so that the window's checks answer it the way main does; main (`linkSession` in src/main/paneldata.ts) applies it inside its write, which also forgets links to sessions that are gone.
 */
export function withLink(data: PanelData, sessionId: string, link: Omit<PanelLink, 'startedAt'>, filed: { repoRoot: string; groupId: string | null }, startedAt: string): PanelData {
  return { sessions: { ...data.sessions, [sessionId]: { ...link, startedAt } }, lastGroup: { ...data.lastGroup, [filed.repoRoot]: filed.groupId } };
}

/**
 * Output beyond this is cut and the process stopped: a panel shows a result, not a log.
 * An `apart` run's stderr counts toward it too.
 */
export const PANEL_OUTPUT_CAP = 1024 * 1024;

/** A run still going after this is stopped: a process that never exits by design is not this panel type. */
export const PANEL_TIMEOUT_MS = 30_000;
