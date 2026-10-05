import type { PanelRunEvent, PanelSource } from '../../../shared/panels';
import type { PanelSlot } from '../layout';
import './command.css';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import { stripAnsi, splitPendingEscape } from '../../ansi';
import { CWD_OPTION, optionsOf } from '../options';
import { NO_CONTEXT, RunGate, endLabel, prepare, resolveContext, runFailed, runKey, type Prepared } from '../run';
import { listenForRuns } from '../run-events';

/**
 * The `command` panel type: runs a command line or a script and shows what it printed.
 *
 * A TYPE OWNS ITS OPTIONS: it declares them here, checks them itself (options.ts) when it is mounted and before every run, and tells the tree through its host when it cannot run.
 * The layout never reads them.
 * The same module owns the panel's body and its run: the tree draws the chrome around it (tree.ts) and asks it to refresh or to follow a context change.
 */

/** Where a command line is cut for a default title: a title is a label, not the whole line. */
export const TITLE_MAX = 40;

/**
 * What an entry runs, in the form the runner takes.
 * Only for options whose check passed, which is what guarantees exactly one is present.
 */
export function commandSource(options: Record<string, unknown>): PanelSource {
  return typeof options.script === 'string' ? { script: options.script } : { command: typeof options.command === 'string' ? options.command : '' };
}

/**
 * An escape sequence cut by a chunk boundary is held back until the next chunk completes it; past this length it is not a sequence but a stream that never terminated one, and it goes out as text.
 */
const PENDING_MAX = 4096;

class CommandPanel implements MountedPanel {
  readonly el = document.createElement('div');
  private readonly output = document.createElement('pre');
  private readonly placeholder = document.createElement('div');
  /**
   * The current run's token, or null while nothing is running.
   * Every event is checked against it, so a superseded run's tail never lands in the new run's body.
   */
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
