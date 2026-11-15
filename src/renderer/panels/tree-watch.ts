import type { Watched } from './run';

/**
 * How often git is asked about a panel's working tree: for a change, while the panel watches one, and again after a check it did not answer, the retries.
 * One period for both, which the retry's own message names.
 */
export const POLL_MS = 30_000;

/** What a panel tells its working-tree watch, asked at each look. */
export interface TreeWatchHooks {
  /** Whether the panel's options watch git as they are now. */
  watching(): boolean;
  /** Whether the panel passed its last check; a panel that cannot run is waiting on its own check. */
  runnable(): boolean;
  /** Whether a run or read of the panel is under way, whose end settles the tree. */
  running(): boolean;
  /** The folder the panel would look in now and its working tree's fingerprint, through the panel's own check, saying nothing it finds; null when that check gives none. */
  look(): Promise<Watched | null>;
  /** The tree changed and stayed as it was for one more look. */
  changed(): void;
}

/**
 * A panel's working tree, looked at every `POLL_MS` from when the panel goes live, shown or not, for a change.
 * A change counts once a second look finds the same fingerprint, so a burst of writes is one change.
 * What the panel's own run or read changes is no change: no look counts while one goes, and its end gives the baseline (`settle`).
 */
export class TreeWatch {
  /**
   * The watched tree as the latest run left it, for the folder last seen: a fingerprint that differs from this, in the same folder, is a change.
   * Another folder replaces it and is no change: a switch is the panel's to answer, as any context change is.
   */
  private baseline: Watched | null = null;
  /** A changed fingerprint seen once, waiting for the next look to find it again. */
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(private readonly hooks: TreeWatchHooks) {}

  /** Start looking, once the panel is live. */
  start(): void {
    this.schedule();
  }

  /**
   * A run or read has ended and is still the latest: the tree as it left it is the baseline, so what it changed itself is no change.
   * Null when git did not answer then, so the next look takes the tree as it is rather than count the run's own writes as a change.
   */
  settle(watched: Watched | null): void {
    this.baseline = watched;
    this.pending = null;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The next look at the watched tree, for a panel whose options watch git as they are then. */
  private schedule(): void {
    if (this.stopped || !this.hooks.watching()) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.look().then(() => this.schedule());
    }, POLL_MS);
  }

  /** Look at the watched tree; not while a run goes, nor for a panel that cannot run. */
  private async look(): Promise<void> {
    if (this.hooks.running() || !this.hooks.runnable()) return;
    const watched = await this.hooks.look();
    // A run can start during the await.
    if (this.stopped || this.hooks.running() || !watched) return;
    this.compare(watched);
  }

  /** A fingerprint against the baseline: the same is no change; another folder becomes its own baseline; a change counts once a second look finds the same. */
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
    this.hooks.changed();
  }
}
