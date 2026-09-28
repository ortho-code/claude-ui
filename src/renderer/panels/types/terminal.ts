import type { PanelContext } from '../../../shared/panels';
import type { PanelSlot } from '../layout';
import { bindTerminal, createTerminal, unbindTerminal, type TerminalView } from '../../terminal';
import { CWD_OPTION, isFixedPath, optionsOf } from '../options';
import { NO_CONTEXT, prepare, resolveContext, type MountedPanel, type PanelHost, type PanelType } from './command';

/**
 * The `terminal` panel type: a plain shell beside the terminal, in a pty, shown in an xterm.
 *
 * IT STAYS PUT. The shell starts where the panel is placed at the moment it first shows — the context directory, or its `cwd` under it, or a fixed `cwd` — and stays there through tab and project switches; a shell has state, and a switch must never kill a command running in it.
 * The header says where it is, and the button restarts it in the current context when that is what you want; a terminal with a fixed `cwd` has no button, since it would restart in the same place.
 * The one exception is a panel with no shell because there was nothing to run in: it starts as soon as a context appears.
 * A shell that EXITS leaves its screen up with a line saying so, and the next key starts a new one, so getting a shell back never depends on a button being there.
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
  /** No shell because the last one exited; a key starts one. */
  private exited = false;
  /** Whether it has been on screen yet: the shell starts on the first reveal, in the context of that moment. */
  private shown = false;
  /** No shell because the options did not pass; a recheck that passes starts one. */
  private refused = false;
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
    // The same observer covers every later reveal — a tab switch, a group unfolding from its rail, a divider reopening a squeezed node — since each one gives the box a size again.
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(this.box);
    // Checked at once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.check();
  }

  refresh(): void {
    this.stop();
    void this.start();
  }

  contextChanged(): void {
    if (this.waiting && !this.starting && resolveContext(this.host.where())) void this.start();
  }

  /** Hiding keeps the shell and whatever runs in it; the refit on reveal is the observer's. */
  setVisible(visible: boolean): void {
    if (!visible) return;
    // Coming back into view while it could not start is a look at it, so it looks again: with no button on a fixed terminal, that is how a folder that has appeared since is picked up.
    if (this.shown) {
      this.recheck();
      return;
    }
    this.shown = true;
    void this.start();
  }

  recheck(): void {
    // Only a panel that was refused has anything to gain: a running shell is never restarted by a change elsewhere in the folder.
    if (!this.refused) return;
    void this.check().then((ok) => {
      if (ok && this.shown && !this.starting && this.terminalId === null) void this.start();
    });
  }

  unmount(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.stop();
    this.view?.term.dispose();
    this.view = null;
  }

  /** Check the options against the selection as it is now, tell the host what is wrong with them, and hand back where the shell would start. */
  private async prepared(): Promise<{ runnable: boolean; context: PanelContext | null }> {
    const prepared = await prepare(optionsOf(this.slot.entry), terminalType, this.host.where());
    if (this.disposed) return { runnable: false, context: null };
    this.refused = prepared.problems.length > 0;
    this.host.setProblems(prepared.problems);
    return { runnable: !this.refused, context: prepared.run };
  }

  private async check(): Promise<boolean> {
    return (await this.prepared()).runnable;
  }

  private async start(): Promise<void> {
    this.exited = false;
    this.starting = true;
    const { runnable, context } = await this.prepared();
    this.starting = false;
    if (!runnable || this.disposed) return;
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
        // The key is the ask for a new shell, so it is not sent on to it.
        else if (this.exited && !this.starting) void this.start();
      });
    } else {
      // A restart: the old shell's screen goes, so the new prompt is not painted over its tail.
      this.view.term.reset();
    }
    this.starting = true;
    this.host.setEnd(folderName(context.cwd));
    this.host.setStatus(null);
    try {
      const id = await window.claudeUi.startShell(context.cwd, context);
      // Gone while it was starting: hand the shell straight back rather than leave one running with nothing showing it.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- dispose() can run during the await, which TypeScript's narrowing does not see
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
          this.exited = true;
          this.host.setEnd(`exited ${exitCode}`);
          // On the shell's own screen, dimmed, where the eye already is; the header's word is what shows while the panel is behind another.
          this.view?.term.write(`\r\n\x1b[2m[exited ${exitCode} — press any key for a new shell]\x1b[0m`);
        },
      });
      this.fit();
    } catch (error) {
      const refused = (error instanceof Error ? error.message : '').includes('MISSING_CWD:');
      this.host.setEnd(refused ? `${context.cwd} is not there` : 'could not start');
      // A shell that exits is somebody typing `exit`; one that never started is the failure worth a dot.
      this.host.setStatus('fail');
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
  options: [CWD_OPTION],
  exactlyOne: [],
  icon: 'terminal',
  defaultTitle: () => 'Terminal',
  // A fixed `cwd` would restart in the same place, which is no action worth a button: a key after the shell exits is how it comes back.
  actionLabel: (options) => (typeof options.cwd === 'string' && isFixedPath(options.cwd) ? null : 'Restart here'),
  mount: (slot, host) => new TerminalPanel(slot, host),
};
