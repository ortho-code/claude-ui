import type { PanelRunEvent, PanelRunRequest } from '../../shared/panels';
import type { MountedPanel, PanelHost } from './contract';
import type { PanelSlot } from './layout';
import { optionsOf } from './options';
import { RunGate, resolveContext, runKey } from './run';
import { listenForRuns } from './run-events';

/**
 * A panel's runs, for the types that run a script and show what it gave — `command` and the `list` kind — written once: when it runs (`RunGate`), the check before every run, each run's token and number, and asking main to run and to stop.
 * The panel keeps its body, says through its hooks (`RunHooks`) what each step looks like and what to run, and hands the tree's calls on to this.
 */

/** A run's last event: it ended by itself, or never started (`exit`), or the app ended it (`stopped`). */
export type RunEnd = Extract<PanelRunEvent, { kind: 'exit' | 'stopped' }>;

/** What a run sends before its end. */
export type RunProgress = Exclude<PanelRunEvent, RunEnd>;

/** What a panel's check found: why it cannot run, one sentence each, and when nothing stops it, what it runs with, or null for nowhere to run. */
export interface Checked<Ready> {
  problems: string[];
  ready: Ready | null;
}

/** A run as the panel asks for it; the entry and the token are added here. */
export type RunAsk = Omit<PanelRunRequest, 'entryId' | 'token'>;

/** What differs between the types that run something: what each checks, what each runs, and what each draws at each step. */
export interface RunHooks<Ready> {
  /** Check the panel against the selection as it is now: when it is mounted, before every run, and on a recheck. */
  check(): Promise<Checked<Ready>>;
  /** A run found the panel cannot run, or (`runnable`) that it can, with nowhere to run. */
  idle(runnable: boolean): void;
  /** A run starts, `tick` when the interval's timer started it: draw its start, and say what to run. */
  start(ready: Ready, tick: boolean): RunAsk;
  /** An event of the run under way, before its end. */
  progress(event: RunProgress): void;
  /** The run under way has ended. */
  ended(event: RunEnd): void;
}

export class PanelRuns<Ready> implements Pick<MountedPanel, 'refresh' | 'contextChanged' | 'setVisible' | 'recheck' | 'unmount'> {
  /**
   * The current run's token, or null while nothing is running.
   * Every event is checked against it, so once a run starts, the run it replaced lands nothing more.
   */
  private token: string | null = null;
  /** The gate's number for the run the token belongs to, told back to the gate when that run ends. */
  private runNumber = 0;
  /** Whether the panel passed its last check; null until the first has answered. */
  private runnable: boolean | null = null;
  private disposed = false;
  private readonly gate: RunGate;
  private readonly stopListening: () => void;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
    /** How often the panel runs on its own, in ms, or null for never; asked each time, so it is the interval the panel's options, or its type, give then. */
    interval: () => number | null,
    private readonly hooks: RunHooks<Ready>,
  ) {
    this.stopListening = listenForRuns(slot.key, (token, event) => this.handle(token, event));
    // Keyed by where the run would go, so a tab or project change that lands on the same place does not run again, and a fixed `cwd` never does.
    this.gate = new RunGate(
      () => runKey(optionsOf(this.slot.entry).cwd, resolveContext(this.host.where())),
      (number, tick) => void this.run(number, tick),
      interval,
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
    const ran = this.gate.setVisible(visible);
    // Coming back into view while it could not run is a look at it, so it looks again — unless showing it just asked for a run, which checks first anyway.
    if (visible && this.runnable === false && !ran) this.recheck();
  }

  recheck(): void {
    const was = this.runnable;
    void this.check().then((checked) => {
      // A panel that could not run and now can runs again, when its gate says (`rerun`); one that already could is left alone, since a change elsewhere in the folder is no reason to re-run it.
      if (checked?.problems.length === 0 && was === false) this.gate.rerun();
    });
  }

  unmount(): void {
    this.disposed = true;
    this.gate.stop();
    if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
    this.token = null;
    this.stopListening();
  }

  /** Check the panel, and tell the host what is wrong with it; null once the panel is gone. */
  private async check(): Promise<Checked<Ready> | null> {
    const checked = await this.hooks.check();
    if (this.disposed) return null;
    this.runnable = checked.problems.length === 0;
    this.host.setProblems(checked.problems);
    return checked;
  }

  /** Every run checks first: a script or a folder can go missing between runs, and the check is what says so in the panel's own words. */
  private async run(number: number, tick: boolean): Promise<void> {
    const checked = await this.check();
    if (!this.gate.isLatest(number) || !checked) return;
    const runnable = checked.problems.length === 0;
    if (!runnable || !checked.ready) {
      if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
      this.token = null;
      this.host.setBusy(false);
      // A panel that cannot run is drawn by the tree as its problems; the panel draws one that can, with nowhere to run.
      this.hooks.idle(runnable);
      if (runnable) this.gate.ended(number);
      return;
    }
    this.token = crypto.randomUUID();
    this.runNumber = number;
    const ask = this.hooks.start(checked.ready, tick);
    this.host.setBusy(true);
    // Main stops the run before this one itself; the token is what keeps that run's tail out of this one.
    window.claudeUi.runPanel({ entryId: this.slot.key, token: this.token, ...ask });
  }

  private handle(token: string, event: PanelRunEvent): void {
    if (token !== this.token) return;
    if (event.kind !== 'exit' && event.kind !== 'stopped') {
      this.hooks.progress(event);
      return;
    }
    this.token = null;
    this.host.setBusy(false);
    this.hooks.ended(event);
    this.gate.ended(this.runNumber);
  }
}
