import type { MountedPanel } from './contract';
import type { RunGate } from './run';

/** What a panel driven through its gate tells the driver, asked as it needs them. */
export interface GateDriverHooks {
  /**
   * Check the panel and say what stops it running, none when nothing does; null once the panel is gone.
   * `fresh` starts afresh whatever a check retries on its own timer.
   */
  check(fresh: boolean): Promise<{ problems: string[] } | null>;
  /** Whether the panel passed its last check; null until the first has answered. */
  runnable(): boolean | null;
  /** The tree showed or hid the panel for the first time: what runs from then on, shown or not, starts here. */
  wentLive(): void;
}

/**
 * What the tree asks of a panel that runs or reads through a `RunGate`, answered once for every such panel: a Refresh, a switch, being shown or hidden, and a recheck.
 * A reveal of a panel that could not run looks at it again, unless showing it already asked for a run, which checks first anyway; a look that finds a panel that could not run now can runs it again, when its gate says (`rerun`).
 */
export class GateDriver implements Pick<MountedPanel, 'refresh' | 'contextChanged' | 'setVisible' | 'recheck'> {
  /** Whether the tree last said the panel is on show. */
  private shown = false;
  /** The tree has shown or hidden the panel at least once. */
  private live = false;

  constructor(
    private readonly gate: RunGate,
    private readonly hooks: GateDriverHooks,
  ) {}

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
      this.hooks.wentLive();
    }
    const ran = this.gate.setVisible(visible);
    if (revealed && this.hooks.runnable() === false && !ran) this.look(true);
  }

  recheck(): void {
    this.look(true);
  }

  /** Check the panel again; one that could not run and now can runs again, while one that already could is left alone, since a change elsewhere is no reason to run it again. */
  look(fresh: boolean): void {
    const was = this.hooks.runnable();
    void this.hooks.check(fresh).then((checked) => {
      if (checked?.problems.length === 0 && was === false) this.gate.rerun();
    });
  }
}

/** A panel whose answers to the tree's Refresh, switch, show and recheck are its driver's. */
export abstract class Driven implements Pick<MountedPanel, 'refresh' | 'contextChanged' | 'setVisible' | 'recheck'> {
  protected abstract readonly driver: GateDriver;

  refresh(): void {
    this.driver.refresh();
  }

  contextChanged(): void {
    this.driver.contextChanged();
  }

  setVisible(visible: boolean): void {
    this.driver.setVisible(visible);
  }

  recheck(): void {
    this.driver.recheck();
  }
}
