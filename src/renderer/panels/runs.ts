import type { PanelRunEvent, PanelRunRequest } from '../../shared/panels';
import type { MountedPanel, PanelHost } from './contract';
import type { PanelSlot } from './layout';
import { optionsOf, watchesGit } from './options';
import { NO_CONTROL, RunGate, readControl, resolveContext, runFailed, runKey, type Watched } from './run';
import { listenForRuns } from './run-events';

/**
 * A panel's runs, for the types that run a script and show what it gave — `command` and the `list` kind — written once: when it runs (`RunGate`), the check before every run, each run's token and number, asking main to run and to stop, what a run said in its control file about the next, and, for a panel that watches git, a run when its working tree changes.
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
  /** One of the problems is git not answering, which it may when asked again. */
  retry?: boolean;
  /** For a panel that watches git whose options and folder pass: the folder and its working tree's fingerprint; a list panel's script may still fail. */
  watched?: Watched;
}

/**
 * How often git is asked about a panel's working tree: for a change, while the panel watches one, and again after a check it did not answer, the retries.
 * One period for both, which the retry's own message names.
 */
const POLL_MS = 30_000;
/** How many times a check git did not answer is asked again, before the panel waits for a Refresh. */
const RETRIES = 3;

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
  /** The panel's own notes, and what the last run's control file got wrong, which the group's note line shows together. */
  private ownNotes: string[] = [];
  private controlNotes: string[] = [];
  /** How many times the check has been asked again since git last failed to answer it, and the next time, if one is waiting. */
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the tree last said the panel is on show. */
  private shown = false;
  /** The tree has shown or hidden the panel at least once: a panel that watches git is asked about from then on, shown or not. */
  private live = false;
  /**
   * The number of the latest run, from its start until its end has been looked at (`rebase`), or null for none going: what a run changes itself is no change, so no look counts meanwhile.
   * By number, so the end of a run a newer one replaced neither clears it nor sets the baseline.
   */
  private activeRun: number | null = null;
  /**
   * The watched tree as the latest run left it, for the folder last seen: a fingerprint that differs from this, in the same folder, is a change.
   * Another folder replaces it and is no change: a switch is the gate's to answer, as any context change is.
   */
  private baseline: Watched | null = null;
  /** A changed fingerprint seen once, waiting for the next poll to find it again: a run only once the tree has been still for one poll, so a burst of writes is one run. */
  private pending: string | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;

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
    // The tree calls this on every redraw, with the panel's visibility as it is, so a reveal is a change from hidden; a redraw is no reason to look at the panel again.
    const revealed = visible && !this.shown;
    this.shown = visible;
    if (!this.live) {
      this.live = true;
      this.schedulePoll();
    }
    const ran = this.gate.setVisible(visible);
    // Coming back into view while it could not run is a look at it, so it looks again — unless showing it just asked for a run, which checks first anyway.
    if (revealed && this.runnable === false && !ran) this.look(true);
  }

  recheck(): void {
    this.look(true);
  }

  /** Check the panel again; `fresh` starts git's retries afresh, which the retry timer's own look does not. */
  private look(fresh: boolean): void {
    const was = this.runnable;
    void this.check(fresh).then((checked) => {
      // A panel that could not run and now can runs again, when its gate says (`rerun`); one that already could is left alone, since a change elsewhere in the folder is no reason to re-run it.
      if (checked?.problems.length === 0 && was === false) this.gate.rerun();
    });
  }

  /** The panel's own notes, which go to the host beside the last run's control notes rather than in their place. */
  setNotes(notes: string[]): void {
    this.ownNotes = notes;
    this.host.setNotes([...this.ownNotes, ...this.controlNotes]);
  }

  /** What the latest run's control file got wrong, by the panel's key, beside the panel's own notes; none for a run that had nothing to say. */
  private setControlNotes(notes: string[]): void {
    this.controlNotes = notes.map((note) => `${this.slot.key}: ${note}`);
    this.host.setNotes([...this.ownNotes, ...this.controlNotes]);
  }

  unmount(): void {
    this.disposed = true;
    this.stopRetrying();
    if (this.pollTimer !== null) clearTimeout(this.pollTimer);
    this.pollTimer = null;
    this.gate.stop();
    if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
    this.token = null;
    this.stopListening();
  }

  /**
   * Check the panel, and tell the host what is wrong with it; null once the panel is gone.
   * A `fresh` check starts git's retries afresh, so a Refresh, a reveal, a change in the config folder or a switch that runs the panel each gets them all; a run its interval started does not, nor the retry timer's own look.
   */
  private async check(fresh = true): Promise<Checked<Ready> | null> {
    if (fresh) this.stopRetrying();
    const checked = await this.hooks.check();
    if (this.disposed) return null;
    this.runnable = checked.problems.length === 0;
    this.host.setProblems([...checked.problems, ...this.retrying(checked)]);
    return checked;
  }

  /**
   * When git did not answer a check, ask again on a timer, a few times, and say which in the panel's problems; once they are used up, say a Refresh asks again.
   * Any other answer, a definite one included, ends the retries; one that finds git answering runs the panel as a recheck does (`rerun`): now when it is shown or has an interval, on its next reveal when neither.
   */
  private retrying(checked: Checked<Ready>): string[] {
    if (!checked.retry || checked.problems.length === 0) {
      this.stopRetrying();
      return [];
    }
    if (this.retries >= RETRIES) return [`Tried ${RETRIES} more times; press Refresh to try again.`];
    this.retryTimer ??= setTimeout(() => {
      this.retryTimer = null;
      this.retries += 1;
      this.look(false);
    }, POLL_MS);
    return [`Trying again in ${POLL_MS / 1000} s (retry ${this.retries + 1} of ${RETRIES}).`];
  }

  private stopRetrying(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
  }

  /** The next look at the watched tree, for a panel whose options watch git as they are then. */
  private schedulePoll(): void {
    if (this.disposed || !watchesGit(optionsOf(this.slot.entry))) return;
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll().then(() => this.schedulePoll());
    }, POLL_MS);
  }

  /**
   * Look at the watched tree, shown or not, through the panel's own check so the folder is the one it would run in now, without saying anything it finds: a problem waits for the next run's check, and git not answering says nothing either way.
   * Not while a run goes, nor for a panel that cannot run, which is waiting on its own check.
   */
  private async poll(): Promise<void> {
    if (this.activeRun !== null || this.runnable !== true) return;
    const checked = await this.hooks.check();
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a run can start during the await, which TypeScript's narrowing does not see
    if (this.disposed || this.activeRun !== null || !checked.watched) return;
    this.compare(checked.watched);
  }

  /** A fingerprint against the baseline: the same is no change; another folder becomes its own baseline; a change runs the panel once a second poll finds the same. */
  private compare(watched: Watched): void {
    if (this.baseline?.dir !== watched.dir) {
      this.baseline = watched;
      this.pending = null;
      return;
    }
    if (watched.fingerprint === this.baseline.fingerprint) {
      this.pending = null;
      return;
    }
    if (watched.fingerprint !== this.pending) {
      this.pending = watched.fingerprint;
      return;
    }
    this.pending = null;
    this.gate.changed();
  }

  /**
   * Run `number` has ended: when it is still the latest, the tree as it left it is the baseline, so what the run changed itself is no change, and looks count again.
   * Git not answering then leaves no baseline, so the next look takes the tree as it is rather than count the run's own writes as a change.
   */
  private async rebase(number: number): Promise<void> {
    const checked = watchesGit(optionsOf(this.slot.entry)) ? await this.hooks.check() : null;
    if (this.disposed || this.activeRun !== number) return;
    this.baseline = checked?.watched ?? null;
    this.pending = null;
    this.activeRun = null;
  }

  /** Every run checks first: a script or a folder can go missing between runs, and the check is what says so in the panel's own words. */
  private async run(number: number, tick: boolean): Promise<void> {
    this.activeRun = number;
    const checked = await this.check(!tick);
    if (!this.gate.isLatest(number) || !checked) return;
    const runnable = checked.problems.length === 0;
    if (!runnable || !checked.ready) {
      if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
      this.token = null;
      this.activeRun = null;
      this.host.setBusy(false);
      // An end too, which ran nothing: what an earlier run's control file got wrong is not this one's.
      this.setControlNotes([]);
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
    // Each end of the current run says afresh what its control file got wrong, so a run that wrote nothing clears what the last one said.
    // A stop the app asked for itself, the quit's, says nothing about the script, as the list kind already reads it.
    const control = event.kind === 'stopped' && !runFailed(event) ? NO_CONTROL : readControl(event.control);
    this.setControlNotes(control.notes);
    this.hooks.ended(event);
    this.gate.ended(this.runNumber, control.next);
    void this.rebase(this.runNumber);
  }
}
