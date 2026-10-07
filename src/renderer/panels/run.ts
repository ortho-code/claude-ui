import type { PanelContext, PanelRunEvent } from '../../shared/panels';
import { PANEL_TIMEOUT_MS } from '../../shared/panels';
import type { View } from '../state/app';
import { tabOnShow } from '../state/views';
import type { Where } from './contract';
import { checkOptions, isFixedPath, type OptionsDecl } from './options';

/**
 * What the types that run something share — `command`, `terminal`, and the `list` kind behind the config folder's types: where a panel runs, when it runs again, and how a run's end is worded.
 */

/** Shown in the empty-pane style when there is neither a tab nor a project to run in. */
export const NO_CONTEXT = 'Pick a project to run this in.';

/** The slices the panels' context is read from, named once: `whereOf` can read only these, and the tree is told of a change to any of them. */
export const WHERE_SLICES = ['activeProject', 'activeTab', 'tabs'] as const;

/**
 * Where the panels are: the tab on show's session, or without one the project chosen.
 * The session is read from the tab itself, since a `/clear` or a move into another folder changes it under the same tab, which is why the tabs are among the slices.
 */
export function whereOf(view: View<(typeof WHERE_SLICES)[number]>): Where {
  const tab = tabOnShow(view);
  return { tab: tab ? { cwd: tab.session.cwd, repoRoot: tab.session.repoRoot, id: tab.session.id } : null, project: view.activeProject };
}

/**
 * The panel's CONTEXT DIRECTORY is the active tab's cwd, else the selected project's repo root, so a worktree session's panel reports the worktree.
 * With neither there is nothing to run in, and the panel says so rather than running somewhere nobody chose.
 */
export function resolveContext(where: Where): PanelContext | null {
  if (where.tab) return { projectRoot: where.tab.repoRoot, cwd: where.tab.cwd, sessionId: where.tab.id };
  if (where.project) return { projectRoot: where.project, cwd: where.project, sessionId: '' };
  return null;
}

/**
 * WHERE A PANEL RUNS, for either type, from its `cwd` option — one rule, pure and tested: without a `cwd`, the context directory itself; with an absolute or `~` one, that folder whatever is selected (FIXED, needing no context); with a relative one, under the context directory, so it follows the project into a subfolder.
 * Null when the panel needs a context and there is none: it says "Pick a project" rather than running somewhere nobody chose.
 */
export type Placement = { kind: 'context' } | { kind: 'fixed'; value: string } | { kind: 'under'; value: string };

export function placement(cwd: unknown, context: PanelContext | null): Placement | null {
  if (typeof cwd !== 'string') return context ? { kind: 'context' } : null;
  if (isFixedPath(cwd)) return { kind: 'fixed', value: cwd };
  return context ? { kind: 'under', value: cwd } : null;
}

/**
 * What a `command` panel's run is keyed on, so a switch that lands where the last run was does not run it again.
 * Without a `cwd`, the whole context, as it always was.
 * A fixed one never changes, so no switch re-runs it: it has nothing new to read.
 * A relative one changes with the folder it lands in, and a tab switch within that folder does not move it.
 */
export function runKey(cwd: unknown, context: PanelContext | null): string {
  const place = placement(cwd, context);
  if (!place) return '';
  if (place.kind === 'context') return contextKey(context);
  if (place.kind === 'fixed') return `fixed\n${place.value}`;
  return `${context!.cwd}\n${place.value}`;
}

/**
 * The context a run or a shell is handed: the selection as it is at that moment, with `cwd` the folder it actually runs in, so `CLAUDE_UI_CWD` tells the truth.
 * A fixed panel with nothing selected gets empty project and session variables rather than none.
 */
export function runContext(context: PanelContext | null, dir: string): PanelContext {
  return { projectRoot: context?.projectRoot ?? '', cwd: dir, sessionId: context?.sessionId ?? '' };
}

/** A panel about to run: what is wrong with its options, or, when nothing is, the context it runs with — null for one with nowhere to run. */
export interface Prepared {
  problems: string[];
  run: PanelContext | null;
}

/**
 * The one path both types take before a run or a shell start, and when they check themselves: check the options against the current selection, then place the panel.
 * The folder comes from the check, so the run goes exactly where main looked.
 */
export async function prepare(options: Record<string, unknown>, decl: OptionsDecl, where: Where): Promise<Prepared> {
  const context = resolveContext(where);
  const { problems, paths } = await checkOptions(options, decl, context?.cwd ?? null);
  if (problems.length > 0) return { problems, run: null };
  const place = placement(options.cwd, context);
  if (!place) return { problems: [], run: null };
  return { problems: [], run: runContext(context, place.kind === 'context' ? context!.cwd : paths.cwd!) };
}

/**
 * The header's word on a run that has ended, or '' for one that ended well.
 * One place for the wording, so the panel's header and anything that later quotes it (a tooltip, a strip) agree.
 */
export function endLabel(event: PanelRunEvent): string {
  switch (event.kind) {
    case 'exit':
      if (event.error) return event.error;
      if (event.code === 0) return '';
      return event.code === null ? `killed by ${event.signal ?? 'a signal'}` : `exit ${event.code}`;
    case 'truncated':
      return 'output cut at 1 MB';
    case 'stopped':
      switch (event.reason) {
        case 'timeout':
          return `stopped after ${PANEL_TIMEOUT_MS / 1000} s`;
        case 'truncated':
          return 'output cut at 1 MB';
        default:
          return 'stopped';
      }
    default:
      return '';
  }
}

/**
 * Whether a run's end is a failure worth a dot on the rail: a non-zero exit, a signal, a failure to start, the timeout, or the output cap.
 * A stop the app asked for itself — a re-run, a removal, the quit — is not the command failing, so it says nothing.
 */
export function runFailed(event: PanelRunEvent): boolean {
  switch (event.kind) {
    case 'exit':
      return event.error !== undefined || event.code !== 0;
    case 'truncated':
      return true;
    case 'stopped':
      return event.reason === 'timeout' || event.reason === 'truncated';
    default:
      return false;
  }
}

/**
 * WHEN a panel that runs something runs, apart from what running does: on first being shown, on Refresh, on a context change while shown, and on its interval if it has one.
 * A context change while the panel is hidden is remembered as a difference, not queued as a run: it runs once on reveal, and not at all if the context came back to where the last run was.
 * An interval runs it while hidden or folded too: from when the tree goes live, shown or not, and then a tick after each run ends, counted from that run's end.
 * No DOM and no process, and no global but that timer, so the deferral is tested without either.
 */
export class RunGate {
  private visible = false;
  /** The tree has shown or hidden the panel at least once: from then on a panel with an interval runs whether shown or not. */
  private live = false;
  /** The context key of the last run; null until the first, so the first reveal always runs. */
  private last: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly key: () => string,
    private readonly run: () => void,
    /** How often the panel runs on its own, in ms, or null for never; asked each time, so it is the panel's options as they are then. */
    private readonly interval: () => number | null = () => null,
  ) {}

  setVisible(visible: boolean): void {
    // The first call is the tree going live: a panel with an interval runs from here, shown or not, so what it shows is true from the start.
    if (!this.live) {
      this.live = true;
      if (!visible && this.interval() !== null) this.fire();
    }
    this.visible = visible;
    this.contextChanged();
  }

  contextChanged(): void {
    if (this.visible && this.key() !== this.last) this.fire();
  }

  refresh(): void {
    this.fire();
  }

  /** Forget the last run, for a panel that could not run and now can: one with an interval runs now once the tree is live, as it would have all along, and any other now if shown and on reveal if not. */
  rerun(): void {
    this.last = null;
    if (this.live && this.interval() !== null) this.fire();
    else this.contextChanged();
  }

  /** A run has ended, or found nowhere to run: the next tick is counted from here. */
  ended(): void {
    this.unschedule();
    const ms = this.interval();
    if (ms === null || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fire();
    }, ms);
  }

  /** The panel is gone, and no tick runs it again. */
  stop(): void {
    this.stopped = true;
    this.unschedule();
  }

  private fire(): void {
    this.last = this.key();
    this.run();
  }

  private unschedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}

function contextKey(context: PanelContext | null): string {
  return context ? `${context.projectRoot}\n${context.cwd}\n${context.sessionId}` : '';
}
