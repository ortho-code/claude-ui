import type { PanelContext } from '../../../shared/panels';
import { bindTerminal, createTerminal, fitTerminal, unbindTerminal, type TerminalView } from '../../ui/terminal';

/** What a shell says of its first problem, as the header's word, which carries no full stop. */
export const problemSaid = (problems: string[]): string => problems[0]?.replace(/\.$/, '') ?? 'could not start';

/** What a shell asks of the panel that holds it. */
export interface ShellOwner {
  /** Whether a start may go ahead where the shell belongs: null when the panel cannot run where you are, which the panel says in its place; else whether this shell may, and why not. */
  check(shell: TerminalShell): Promise<{ runnable: boolean; problems: string[] } | null>;
  /** What a shell started in `folder` runs with. */
  context(shell: TerminalShell, folder: string): PanelContext;
  /** The panel's entry, which main files the shell under. */
  entryId: string;
  /** Whether the shell is the tab on show, which alone takes the keys when it starts. */
  shown(shell: TerminalShell): boolean;
  /** Something its tab shows changed. */
  changed(): void;
  /** A start ended: null when its shell runs, else why not, in the header's words. */
  ended(said: string | null): void;
}

/** A shell the panel holds, in a pty and an xterm of its own, and the tab it is shown under. */
export class TerminalShell {
  readonly box = document.createElement('div');
  view: TerminalView | null = null;
  /** Its live shell's terminal id, or null while there is none. */
  terminalId: number | null = null;
  starting = false;
  /** No shell because the last one ended, or never started: a key starts one. */
  exited = false;
  /** Closed while its shell was still starting, which then hands that shell straight back. */
  closed = false;
  /** Picked by you before it had a terminal to focus: it takes the keys once it has one. */
  focusWhenStarted = false;
  /** Which of its starts is the latest: a start overtaken by another, a restart asked for while it was on its way, hands its shell straight back. */
  private starts = 0;
  // Fit whenever the box changes size, its first layout included: a shell is made before its box is on screen, so it measures nothing yet, and a fit now would leave xterm at its 80×24 default — the hidden-pane trap.
  // The same observer covers every later reveal — its tab picked, a group unfolding from its rail, a divider reopening a squeezed node — since each gives the box a size again.
  private readonly observer = new ResizeObserver(() => this.fit());

  constructor(
    parent: HTMLElement,
    private readonly owner: ShellOwner,
    /** The panel's own id for it, which its tab is drawn by. */
    readonly id: string,
    public name: string,
    /** The project it belongs to, its repo root, for a panel that shows shells by project; null for one that shows every shell everywhere. */
    readonly project: string | null,
    /** The folder its shell starts in: where it was made or Restart here last started it, or for one brought back, where it was when the app last quit. */
    public folder: string,
  ) {
    this.box.className = 'panel-terminal';
    this.box.hidden = true;
    parent.append(this.box);
    this.observer.observe(this.box);
  }

  /**
   * Start a shell in `folder` for the tab, on its own screen, wiped when it had one before.
   * Only its latest start counts: one overtaken on its way, by a restart or a close, hands its shell straight back and leaves the tab to the start that overtook it.
   */
  async start(folder: string): Promise<void> {
    const start = ++this.starts;
    const latest = (): boolean => this.starts === start && !this.closed;
    this.exited = false;
    this.starting = true;
    const checked = await this.owner.check(this);
    if (!latest()) return;
    // The panel cannot run where you are: it says why in its place, over every shell, and starts none behind that, another project's shell included.
    if (checked === null) {
      this.starting = false;
      return;
    }
    if (!this.view) {
      const view = createTerminal(this.box);
      this.view = view;
      view.term.onData((data) => {
        if (this.terminalId !== null) window.claudeUi.sendTerminalInput(this.terminalId, data);
        // The key is the ask for a new shell, so it is not sent on to it.
        else if (this.exited && !this.starting) void this.start(this.folder);
      });
    } else {
      // A restart: the old shell's screen goes, so the new prompt is not painted over its tail.
      this.view.term.reset();
    }
    this.owner.changed();
    const { term } = this.view;
    if (!checked.runnable) {
      // Refused in its own project: this shell alone says why, as a start main refuses does.
      this.failed(problemSaid(checked.problems));
      this.starting = false;
      this.owner.changed();
      return;
    }
    try {
      const id = await window.claudeUi.startShell(folder, this.owner.context(this, folder), { entryId: this.owner.entryId, shellId: this.id });
      // Closed or overtaken while it was starting: hand the shell straight back rather than leave one running with nothing showing it.
      if (!latest()) {
        window.claudeUi.killTerminal(id);
        return;
      }
      this.terminalId = id;
      bindTerminal(id, {
        data: (data) => term.write(data),
        exit: (exitCode) => {
          if (this.terminalId !== id) return;
          this.terminalId = null;
          this.exited = true;
          // On the shell's own screen, dimmed, where the eye already is; its tab goes unfilled, as a tab with nothing behind it does.
          term.write(`\r\n\x1b[2m[exited ${exitCode} — press any key for a new shell]\x1b[0m`);
          this.owner.changed();
        },
      });
      this.owner.ended(null);
      this.fit();
      // Only while it is on show: keys typed into a shell out of sight would go where nobody can see them.
      if (this.focusWhenStarted && this.owner.shown(this)) term.focus();
      this.focusWhenStarted = false;
    } catch (error) {
      if (!latest()) return;
      const missing = (error instanceof Error ? error.message : '').includes('MISSING_CWD:');
      this.failed(missing ? `${folder} is not there` : 'could not start');
    } finally {
      // An overtaken start leaves the tab to the start that overtook it.
      if (latest()) {
        this.starting = false;
        this.owner.changed();
      }
    }
  }

  /** A shell that could not start says why on its own screen, dimmed, with a key to try again, and in the header. */
  private failed(said: string): void {
    this.exited = true;
    this.view?.term.write(`\x1b[2m[${said} — press any key to try again]\x1b[0m`);
    this.owner.ended(said);
  }

  /** End its shell, if it has one, and stop listening to it: its tail belongs to nobody once a restart or a close has been asked for. */
  stop(): void {
    if (this.terminalId === null) return;
    unbindTerminal(this.terminalId);
    window.claudeUi.killTerminal(this.terminalId);
    this.terminalId = null;
  }

  dispose(): void {
    this.closed = true;
    this.stop();
    this.observer.disconnect();
    this.view?.term.dispose();
    this.view = null;
    this.box.remove();
  }

  private fit(): void {
    if (!this.view || this.box.hidden || this.box.clientWidth === 0 || this.box.clientHeight === 0) return;
    fitTerminal(this.view);
    if (this.terminalId !== null) window.claudeUi.resizeTerminal(this.terminalId, this.view.term.cols, this.view.term.rows);
  }
}
