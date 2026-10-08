import type { PanelContext, PanelSource } from '../../../shared/panels';
import type { PanelSlot } from '../layout';
import './command.css';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import { stripAnsi, splitPendingEscape } from '../../ansi';
import { CWD_OPTION, INTERVAL_OPTION, intervalOf, optionsOf } from '../options';
import { NO_CONTEXT, endLabel, prepare, runFailed } from '../run';
import { PanelRuns, type Checked, type RunAsk, type RunEnd, type RunHooks, type RunProgress } from '../runs';

/**
 * The `command` panel type: runs a command line or a script and shows what it printed.
 *
 * A TYPE OWNS ITS OPTIONS: it declares them here, checks them itself (options.ts) when it is mounted and before every run, and tells the tree through its host when it cannot run.
 * The layout never reads them.
 * The same module owns the panel's body, and its runs through `PanelRuns`, which a list panel's go through too: the tree draws the chrome around it (tree.ts) and asks it to refresh or to follow a context change.
 * WHEN IT RUNS (`RunGate`): on first being shown, on Refresh, on a context change while shown, and on its `interval` if it has one, which also runs it while hidden or folded, as a list panel's does.
 * A run the interval's timer starts holds the output on show, the header's word and the dot until it ends (`held`); a press or a switch starts the body afresh.
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

class CommandPanel implements MountedPanel, RunHooks<PanelContext> {
  readonly el = document.createElement('div');
  private readonly output = document.createElement('pre');
  private readonly placeholder = document.createElement('div');
  /**
   * Where a run the interval's timer started writes, out of sight, while the output on show stays as it was — with the header's word and the dot — until the run ends and this takes its place; null for any other run, which writes straight into the output.
   * Nobody asked for a tick, so the text under the reader does not move meanwhile, and only the busy mark says a run is going; a press or a switch is seen to start.
   */
  private held: DocumentFragment | null = null;
  private pending = '';
  private readonly runs: PanelRuns<PanelContext>;

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
    this.runs = new PanelRuns(slot, host, () => intervalOf(optionsOf(this.slot.entry)), this);
  }

  refresh(): void {
    this.runs.refresh();
  }

  contextChanged(): void {
    this.runs.contextChanged();
  }

  setVisible(visible: boolean): void {
    this.runs.setVisible(visible);
  }

  recheck(): void {
    this.runs.recheck();
  }

  unmount(): void {
    this.runs.unmount();
  }

  /** The options against the selection as it is now, and where the panel would run. */
  async check(): Promise<Checked<PanelContext>> {
    const { problems, run } = await prepare(optionsOf(this.slot.entry), commandType, this.host.where());
    return { problems, ready: run };
  }

  idle(runnable: boolean): void {
    this.host.setEnd('');
    this.host.setStatus(null);
    this.held = null;
    this.output.hidden = true;
    // A panel that cannot run is drawn by the tree as its problems; the placeholder is for one that can, with nowhere to run.
    this.placeholder.hidden = !runnable;
  }

  start(context: PanelContext, tick: boolean): RunAsk {
    this.pending = '';
    // Only output a run left on show is held: one that found nowhere to run, or could not run, hid it, and what it holds is from before that, not to come back.
    this.held = tick && !this.output.hidden ? document.createDocumentFragment() : null;
    if (!this.held) {
      this.host.setEnd('');
      this.host.setStatus(null);
      this.output.replaceChildren();
    }
    this.output.hidden = false;
    this.placeholder.hidden = true;
    return { stderr: 'merged', source: commandSource(optionsOf(this.slot.entry)), context };
  }

  progress(event: RunProgress): void {
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
        // Held, the header waits for the run's end, whose word and dot replace these either way.
        if (this.held) return;
        this.host.setEnd(endLabel(event));
        this.host.setStatus('fail');
        return;
    }
  }

  ended(event: RunEnd): void {
    this.append(this.pending);
    this.pending = '';
    // The same element keeps its children's place, so the scroll stays where it was as far as the new output reaches.
    if (this.held) this.output.replaceChildren(this.held);
    this.held = null;
    this.host.setEnd(endLabel(event));
    this.host.setStatus(runFailed(event) ? 'fail' : null);
  }

  private append(text: string): void {
    const clean = stripAnsi(text);
    // A text node per chunk rather than `textContent +=`, which would re-copy everything before it on every chunk.
    if (clean) (this.held ?? this.output).appendChild(document.createTextNode(clean));
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
    INTERVAL_OPTION,
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
