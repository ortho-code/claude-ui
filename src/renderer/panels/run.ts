import type { PanelContext, PanelRunEvent } from '../../shared/panels';
import { PANEL_TIMEOUT_MS } from '../../shared/panels';
import type { Where } from './contract';
import { checkOptions, isFixedPath, type OptionsDecl } from './options';

/**
 * What the types that run something share — `command`, `terminal`, and the `list` kind behind the config folder's types: where a panel runs, when it runs again, and how a run's end is worded.
 */

/** Shown in the empty-pane style when there is neither a tab nor a project to run in. */
export const NO_CONTEXT = 'Pick a project to run this in.';

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
 * WHERE A PANEL RUNS, for either type, from its `cwd` option — one rule, pure and tested:
 * without a `cwd`, the context directory itself; with an absolute or `~` one, that folder whatever is selected (FIXED, needing no context); with a relative one, under the context directory, so it follows the project into a subfolder.
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
 * Without a `cwd`, the whole context, as it always was. A fixed one never changes, so no switch re-runs it: it has nothing new to read. A relative one changes with the folder it lands in, and a tab switch within that folder does not move it.
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
 * WHEN a panel that follows its context runs, apart from what running does: on first being shown, on Refresh, and on a context change — but never while hidden.
 * A change that happens while the panel is hidden is remembered as a difference, not queued as a run: it runs once on reveal, and not at all if the context came back to where the last run was.
 * Pure, so the deferral is tested without a DOM or a process.
 */
export class RunGate {
  private visible = false;
  /** The context key of the last run; null until the first, so the first reveal always runs. */
  private last: string | null = null;

  constructor(
    private readonly key: () => string,
    private readonly run: () => void,
  ) {}

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.contextChanged();
  }

  contextChanged(): void {
    if (this.visible && this.key() !== this.last) this.fire();
  }

  refresh(): void {
    this.fire();
  }

  /** Forget the last run, so it runs again now if shown and on reveal if not: for a panel that could not run and now can. */
  rerun(): void {
    this.last = null;
    this.contextChanged();
  }

  private fire(): void {
    this.last = this.key();
    this.run();
  }
}

function contextKey(context: PanelContext | null): string {
  return context ? `${context.projectRoot}\n${context.cwd}\n${context.sessionId}` : '';
}
