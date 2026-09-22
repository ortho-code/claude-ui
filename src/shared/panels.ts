/**
 * Panels: the layout file's shape, what main reports about one read of it, and how a `command` panel's run reaches the renderer.
 *
 * The layout file is hand-edited, and that decides two things here.
 * Its shape is the TREE from the long design (`sides.right.groups[].panels[]`) even though this build honours one panel, so nothing written now is thrown away when groups and docking arrive.
 * And nothing in it is trusted at the type level: main hands the parsed JSON over as `unknown`, and the renderer's validator names every mistake in the entry's place rather than dropping it — a person wrote the file, so a silent drop would be a lie about what they wrote.
 */

/** The layout file's `version`. The one shape this build reads; anything else renders a degraded panel saying so. */
export const LAYOUT_VERSION = 1;

/**
 * One panel, as an entry in the layout file: the statusline's shape, an inline entry that is a command line or a script path.
 * `id` is a slug the user writes (`^[a-z0-9][a-z0-9-]*$`), unique in the file, and what panel state keys on.
 * `title` and `hidden` are optional; the parameters after them belong to the entry's `type`, whose module declares them once (`renderer/panels/types/*`).
 */
export interface PanelEntry {
  id: string;
  type: string;
  title?: string;
  hidden?: boolean;
  /** `command` type: a command line, run as typed by the shell in the context directory. */
  command?: string;
  /** `command` type: a path to an executable, relative to the config folder or absolute, checked when the layout is read. */
  script?: string;
}

export interface LayoutGroup {
  /** Share of the side; read only while no pixel size is stored for it. */
  size?: number;
  panels: PanelEntry[];
}

export interface LayoutSide {
  /** Share of the window; read only while no pixel width is stored. */
  size?: number;
  groups: LayoutGroup[];
}

/** A layout file as this build reads it. */
export interface Layout {
  version: typeof LAYOUT_VERSION;
  sides: { right?: LayoutSide };
}

/** How one `script` value checked out when the layout was read. Main's, because main has the filesystem. */
export interface ScriptCheck {
  /** The absolute path the value resolved to. */
  path: string;
  /** What is wrong with it, as a sentence naming the value as written, or null when it exists and is executable. */
  problem: string | null;
}

/**
 * One read of the layout file, before any validation of its shape.
 *
 * `missing`: there is no file, so there is no layout. `unparsable`: the file is there and could not be used, and `error` says why and where — the renderer keeps the last good layout up. `read`: `json` holds whatever the file parsed to.
 * The script checks travel with the read so one report answers everything about the file, and they are keyed by the value AS WRITTEN rather than by entry id, so a duplicate or malformed id cannot lose one.
 */
export interface LayoutReport {
  configRoot: string;
  file: string;
  status: 'missing' | 'unparsable' | 'read';
  error: string | null;
  json: unknown;
  scripts: Record<string, ScriptCheck>;
}

/** What a `command` panel runs: exactly one of the two, as the entry gave it. */
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
