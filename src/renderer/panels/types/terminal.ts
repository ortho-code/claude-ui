import type { PanelSlot } from '../layout';
import { bindTerminal, createTerminal, unbindTerminal, type TerminalView } from '../../terminal';
import { NO_CONTEXT, resolveContext, type MountedPanel, type PanelHost, type PanelType } from './command';

/**
 * The `terminal` panel type: a plain shell beside the terminal, in a pty, shown in an xterm.
 *
 * IT STAYS PUT. The shell starts in the context directory of the moment the panel first shows and stays there through tab and project switches; a shell has state, and a switch must never kill a command running in it.
 * The header says where it is, and the button restarts it in the current context when that is what you want.
 * The one exception is a panel with no shell because there was nothing to run in: it starts as soon as a context appears.
 */

class TerminalPanel implements MountedPanel {
  readonly el = document.createElement('div');
  private readonly box = document.createElement('div');
  private readonly placeholder = document.createElement('div');
  private view: TerminalView | null = null;
  /** The live shell's terminal id, or null while there is none. */
  private terminalId: number | null = null;
  private starting = false;
  /** No shell because there was no context; a context appearing starts one. */
  private waiting = false;
  private disposed = false;
  private readonly observer: ResizeObserver;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
  ) {
    this.el.className = 'panel-body';
    this.box.className = 'panel-terminal';
    this.placeholder.className = 'pane-placeholder';
    this.placeholder.textContent = NO_CONTEXT;
    this.placeholder.hidden = true;
    this.el.append(this.box, this.placeholder);
    // Fit whenever the box changes size, its first layout included: the panel is mounted before the side has placed it, so the box measures nothing yet, and a fit now would leave xterm at its 80×24 default — the hidden-pane trap.
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.box);
    void this.start();
  }

  refresh(): void {
    this.stop();
    void this.start();
  }

  contextChanged(): void {
    if (this.waiting && !this.starting && resolveContext(this.host.where())) void this.start();
  }

  unmount(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.stop();
    this.view?.term.dispose();
    this.view = null;
  }

  private async start(): Promise<void> {
    const context = resolveContext(this.host.where());
    if (!context) {
      this.waiting = true;
      this.box.hidden = true;
      this.placeholder.hidden = false;
      this.host.setEnd('');
      return;
    }
    this.waiting = false;
    this.box.hidden = false;
    this.placeholder.hidden = true;
    if (!this.view) {
      this.view = createTerminal(this.box);
      this.view.term.onData((data) => {
        if (this.terminalId !== null) window.claudeUi.sendTerminalInput(this.terminalId, data);
      });
    } else {
      // A restart: the old shell's screen goes, so the new prompt is not painted over its tail.
      this.view.term.reset();
    }
    this.starting = true;
    this.host.setEnd(folderName(context.cwd));
    try {
      const id = await window.claudeUi.startShell(context.cwd, context);
      // Gone while it was starting: hand the shell straight back rather than leave one running with nothing showing it.
      if (this.disposed) {
        window.claudeUi.killTerminal(id);
        return;
      }
      this.terminalId = id;
      bindTerminal(id, {
        data: (data) => this.view?.term.write(data),
        exit: (exitCode) => {
          if (this.terminalId !== id) return;
          this.terminalId = null;
          this.host.setEnd(`exited ${exitCode}`);
        },
      });
      this.fit();
    } catch (error) {
      const refused = /MISSING_CWD:/.test(error instanceof Error ? error.message : '');
      this.host.setEnd(refused ? `${context.cwd} is not there` : 'could not start');
    } finally {
      this.starting = false;
    }
  }

  /** End the shell, if there is one, and stop listening to it: its tail belongs to nobody once a restart has been asked for. */
  private stop(): void {
    if (this.terminalId === null) return;
    unbindTerminal(this.terminalId);
    window.claudeUi.killTerminal(this.terminalId);
    this.terminalId = null;
  }

  private fit(): void {
    if (!this.view || this.box.hidden || this.box.clientWidth === 0 || this.box.clientHeight === 0) return;
    this.view.fitAddon.fit();
    if (this.terminalId !== null) window.claudeUi.resizeTerminal(this.terminalId, this.view.term.cols, this.view.term.rows);
  }
}

/** The header names the folder the shell is in by its last segment: "claude-ui", or a worktree's name. */
function folderName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

export const terminalType: PanelType = {
  name: 'terminal',
  params: [],
  exactlyOne: [],
  defaultTitle: () => 'Terminal',
  actionLabel: 'Restart here',
  mount: (slot, host) => new TerminalPanel(slot, host),
};
