import type { PanelContext, PanelRunEvent, PanelSource } from '../../../shared/panels';
import { PANEL_TIMEOUT_MS } from '../../../shared/panels';
import type { PanelSlot } from '../layout';
import type { IconName } from '../icons';
import { stripAnsi, splitPendingEscape } from '../../ansi';
import { CWD_OPTION, checkOptions, isFixedPath, optionsOf, type OptionsDecl } from '../options';
import { listenForRuns } from '../runs';

/**
 * The `command` panel type: runs a command line or a script and shows what it printed.
 *
 * A TYPE OWNS ITS OPTIONS: it declares them here, checks them itself (options.ts) when it is mounted and before every run, and tells the tree through its host when it cannot run. The layout never reads them.
 * The same module owns the panel's body and its run: the tree draws the chrome around it (tree.ts) and asks it to refresh or to follow a context change.
 */

/** What the LAYOUT knows about a type: how to draw and place an entry of it, and nothing about its options. */
export interface PanelTypeDecl {
  name: string;
  /**
   * The title an entry gets when it names none, from its options where they give one; null when they do not, and the layout uses the id.
   * Called before the type has checked anything, so it reads the options defensively.
   */
  defaultTitle(options: Record<string, unknown>): string | null;
  /** The icon an entry wears on a rail when it names none. */
  icon: IconName;
  /** The panel carries its own chrome, so a group holding only it draws no header. */
  bare?: boolean;
  /**
   * The layout must place this type EXACTLY ONCE: one missing is added, a second copy is refused in its place, and `hidden` is ignored.
   * For the app's own surfaces, without which the window is not usable — the rule is the validator's, so no file can produce a window without the terminal.
   */
  singleton?: boolean;
  /**
   * What the type itself was built from, for one that can change while the app runs — a type from the config folder, whose manifest is edited by hand: a change mounts its entries afresh.
   * Absent for a built-in, which changes only with the build.
   */
  revision?: string;
}

/** Where a panel would run right now: the renderer's active tab and selected project, as the side reads them. */
export interface Where {
  tab: { cwd: string; repoRoot: string; id: string } | null;
  project: string | null;
}

/**
 * What a panel's icon on a rail says about it, so a panel that is not on show still reports: a session waiting for you, or a run that failed. Null says nothing.
 */
export type PanelStatus = 'wait' | 'fail' | null;

/** What the tree gives a mounted panel: where it is, and the marks around it that are the tree's to draw — the panel's side of the conversation with the layout. */
export interface PanelHost {
  where(): Where;
  setBusy(busy: boolean): void;
  /** The header's word on the last run: `exit 3`, `stopped after 30 s`, or '' for a run that ended well. */
  setEnd(label: string): void;
  /** The dot on the panel's rail icon. */
  setStatus(status: PanelStatus): void;
  /**
   * Why the panel cannot run, one sentence each, or none when it can: the tree draws them in the panel's place, with the same problem list as the layout's own refusals, and puts `alert` on its rail icon.
   * Different from a failed RUN, which is the red dot: this is a panel that will not start as its options stand.
   */
  setProblems(problems: string[]): void;
  /** Sentences about the panel that do not stop it running, shown in its group's note line. */
  setNotes(notes: string[]): void;
}

export interface MountedPanel {
  /** The panel's body, which the side places under its header. */
  el: HTMLElement;
  /** Run again, now. */
  refresh(): void;
  /** The tab or project changed; run again if that moved the panel's context. */
  contextChanged(): void;
  /**
   * The panel went behind another tab, into a folded group, or back on screen.
   * A panel is mounted HIDDEN and shown by the first call with true, which is where it first runs.
   * Hiding stops nothing: a hidden panel keeps its DOM and its process, and only removal from the file ends them.
   */
  setVisible(visible: boolean): void;
  /** Something in the config folder changed: check the options again, since a file or folder they point at may have appeared or changed. */
  recheck(): void;
  /** The panel is leaving the layout: stop its run and forget it. */
  unmount(): void;
}

export interface PanelType extends PanelTypeDecl, OptionsDecl {
  /** What the header's one button does, for its tooltip and label, from the entry's options: "Refresh" when the type says nothing, and no button for null. */
  actionLabel?(options: Record<string, unknown>): string | null;
  mount(slot: PanelSlot, host: PanelHost): MountedPanel;
}

/** Where a command line is cut for a default title: a title is a label, not the whole line. */
export const TITLE_MAX = 40;

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

/** What an entry runs, in the form the runner takes. Only for options whose check passed, which is what guarantees exactly one is present. */
export function commandSource(options: Record<string, unknown>): PanelSource {
  return typeof options.script === 'string' ? { script: options.script } : { command: typeof options.command === 'string' ? options.command : '' };
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
 * An escape sequence cut by a chunk boundary is held back until the next chunk completes it; past this length it is not a sequence but a stream that never terminated one, and it goes out as text.
 */
const PENDING_MAX = 4096;

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

class CommandPanel implements MountedPanel {
  readonly el = document.createElement('div');
  private readonly output = document.createElement('pre');
  private readonly placeholder = document.createElement('div');
  /** The current run's token, or null while nothing is running. Every event is checked against it, so a superseded run's tail never lands in the new run's body. */
  private token: string | null = null;
  private pending = '';
  private readonly gate: RunGate;
  /** Whether the options passed their last check; null until the first has answered. */
  private runnable: boolean | null = null;
  /** Counts the runs asked for, so one whose check is overtaken by a newer ask drops out rather than starting after it. */
  private asked = 0;
  private disposed = false;
  private readonly stopListening: () => void;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
  ) {
    this.el.className = 'panel-body';
    this.output.className = 'panel-output';
    this.placeholder.className = 'pane-placeholder';
    this.placeholder.textContent = NO_CONTEXT;
    this.placeholder.hidden = true;
    this.el.append(this.output, this.placeholder);
    this.stopListening = listenForRuns(slot.key, (token, event) => this.handle(token, event));
    // Keyed by where the run would go, so a tab or project change that lands on the same place does not run again, and a fixed `cwd` never does.
    this.gate = new RunGate(
      () => runKey(optionsOf(this.slot.entry).cwd, resolveContext(this.host.where())),
      () => void this.run(),
    );
    // Checked at once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.check();
  }

  refresh(): void {
    this.gate.refresh();
  }

  contextChanged(): void {
    this.gate.contextChanged();
  }

  setVisible(visible: boolean): void {
    const asked = this.asked;
    this.gate.setVisible(visible);
    // Coming back into view while it could not run is a look at it, so it looks again — unless showing it just asked for a run, which checks first anyway.
    if (visible && this.runnable === false && this.asked === asked) this.recheck();
  }

  recheck(): void {
    const was = this.runnable;
    void this.check().then((ok) => {
      // A panel that could not run and now can runs again; one that already could is left alone, since a change elsewhere in the folder is no reason to re-run it.
      if (ok && was === false) this.gate.rerun();
    });
  }

  unmount(): void {
    this.disposed = true;
    if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
    this.token = null;
    this.stopListening();
  }

  /** Check the options against the selection as it is now, tell the host what is wrong with them, and hand back where the panel would run. */
  private async prepared(): Promise<Prepared | null> {
    const prepared = await prepare(optionsOf(this.slot.entry), commandType, this.host.where());
    if (this.disposed) return null;
    this.runnable = prepared.problems.length === 0;
    this.host.setProblems(prepared.problems);
    return prepared;
  }

  private async check(): Promise<boolean> {
    return (await this.prepared())?.problems.length === 0;
  }

  /** Every run checks first: a script or a folder can go missing between runs, and the check is what says so in the panel's own words. */
  private async run(): Promise<void> {
    const asked = ++this.asked;
    const prepared = await this.prepared();
    if (asked !== this.asked || !prepared) return;
    const runnable = prepared.problems.length === 0;
    const context = prepared.run;
    this.host.setEnd('');
    this.host.setStatus(null);
    if (!runnable || !context) {
      if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
      this.token = null;
      this.host.setBusy(false);
      this.output.hidden = true;
      // A panel that cannot run is drawn by the tree as its problems; the placeholder is for one that can, with nowhere to run.
      this.placeholder.hidden = !runnable;
      return;
    }
    this.token = crypto.randomUUID();
    this.pending = '';
    this.output.replaceChildren();
    this.output.hidden = false;
    this.placeholder.hidden = true;
    this.host.setBusy(true);
    // The runner stops the run before this one itself; the token is what keeps that run's tail out of this body.
    window.claudeUi.runPanel({ entryId: this.slot.key, stderr: 'merged', token: this.token, source: commandSource(optionsOf(this.slot.entry)), context });
  }

  private handle(token: string, event: PanelRunEvent): void {
    if (token !== this.token) return;
    switch (event.kind) {
      case 'output': {
        const [text, tail] = splitPendingEscape(this.pending + event.text);
        if (tail.length > PENDING_MAX) {
          this.append(text + tail);
          this.pending = '';
        } else {
          this.append(text);
          this.pending = tail;
        }
        return;
      }
      // Never sent to this panel's runs, which are `merged`: its stderr arrives as output.
      case 'stderr':
        return;
      case 'truncated':
        this.host.setEnd(endLabel(event));
        this.host.setStatus('fail');
        return;
      case 'exit':
      case 'stopped':
        this.append(this.pending);
        this.pending = '';
        this.token = null;
        this.host.setBusy(false);
        this.host.setEnd(endLabel(event));
        this.host.setStatus(runFailed(event) ? 'fail' : null);
        return;
    }
  }

  private append(text: string): void {
    const clean = stripAnsi(text);
    // A text node per chunk rather than `textContent +=`, which would re-copy everything before it on every chunk.
    if (clean) this.output.appendChild(document.createTextNode(clean));
  }
}

function contextKey(context: PanelContext | null): string {
  return context ? `${context.projectRoot}\n${context.cwd}\n${context.sessionId}` : '';
}

/**
 * Two ways to say what runs, exactly one required.
 * The type keeps the name `command` although a `script` is not a command line, because a one-liner is not a script either and Claude Code's own statusline and hooks are `"type": "command"` for both.
 */
export const commandType: PanelType = {
  name: 'command',
  options: [
    { name: 'command', kind: 'text' },
    { name: 'script', kind: 'path', against: 'config', must: 'executable' },
    CWD_OPTION,
  ],
  exactlyOne: [['command', 'script']],
  icon: 'command',
  defaultTitle: (options) => {
    if (typeof options.script === 'string' && options.script.trim() !== '') return options.script.split('/').filter(Boolean).at(-1) ?? options.script;
    const line = typeof options.command === 'string' ? options.command.trim() : '';
    if (line === '') return null;
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
  },
  mount: (slot, host) => new CommandPanel(slot, host),
};
