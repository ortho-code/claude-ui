import type { DiffFile, DiffView } from '../../../../../shared/diff/types';
import type { EditorUi } from '../../../../../shared/types';
import type { FileRef } from '../../../../state/editor-tabs';
import { TreeWatch } from '../../../tree-watch';
import { FileView } from './file-view';

/** What a file's tab asks of the Editor it is in: the picks every tab draws by, and how wide the Editor is. */
export interface FileDocHost {
  picks(): EditorUi;
  /** Whether the Editor is wide enough for Fit to draw split. */
  wide(): boolean;
  pick(change: Partial<EditorUi>): void;
  /** This tab stepped to another file of its sequence, `ref`, which it already shows. */
  step(ref: FileRef): void;
  /** This tab read its file again, now compared as `ref` says. */
  refreshed(ref: FileRef): void;
}

/**
 * One file's tab in the Editor: its diff against what its opener asked, drawn by the file view, and read again when its checkout's working tree changes, on its own watch, so it needs no panel beside it.
 * Its sequence steps from file to file as the list it was opened from orders them.
 */
export class FileDoc {
  readonly view: FileView;
  private readonly watch: TreeWatch;
  private reading = false;
  private disposed = false;

  constructor(
    private ref: FileRef,
    private readonly host: FileDocHost,
  ) {
    this.view = new FileView({
      source: () => ({ root: this.ref.root, against: this.ref.diff.against }),
      view: () => host.picks().view,
      split: () => host.picks().view === 'split' || (host.picks().view === 'fit' && host.wide()),
      ignoreWs: () => host.picks().ignoreWs,
      changesOnly: () => host.picks().changesOnly,
      pickView: (view: DiffView) => host.pick({ view }),
      pickIgnoreWs: (ignoreWs) => host.pick({ ignoreWs }),
      pickChangesOnly: (changesOnly) => host.pick({ changesOnly }),
      stepFile: (delta) => void this.stepFile(delta),
      place: () => ({ at: this.ref.files.findIndex((file) => file.path === this.ref.file.path) + 1, of: this.ref.files.length }),
    });
    this.watch = new TreeWatch({
      watching: () => true,
      runnable: () => !this.disposed,
      running: () => this.reading,
      look: () => this.look(),
      changed: () => void this.reread(),
    });
    void this.view.show(ref.file);
    void this.look().then((watched) => this.watch.settle(watched));
    this.watch.start();
  }

  /** Show `ref`: the same file read again, compared as it now says, or another file afresh. */
  showRef(ref: FileRef): Promise<void> {
    if (ref === this.ref) return Promise.resolve();
    const same = ref.root === this.ref.root && ref.file.path === this.ref.file.path && ref.diff.against === this.ref.diff.against;
    this.ref = ref;
    if (same) {
      this.view.refreshed(ref.file);
      return Promise.resolve();
    }
    return this.view.show(ref.file);
  }

  release(): void {
    this.disposed = true;
    this.watch.stop();
  }

  /**
   * Step into the next or previous file of the sequence that has a change to step to, round from the last to the first, landing on its first change, or its last when stepping back; a generated file still folded has none.
   * Coming round to the file it started from, with no other to step into, it goes round within that one.
   */
  private async stepFile(delta: 1 | -1): Promise<void> {
    const start = this.ref;
    const files = start.files;
    const from = files.findIndex((file) => file.path === start.file.path);
    for (let hop = 1; hop <= files.length; hop++) {
      const file = files[(from + delta * hop + files.length * hop) % files.length]!;
      if (file.path === start.file.path) break;
      this.ref = { ...start, file };
      await this.view.show(file, delta > 0 ? 'first' : 'last');
      if (this.disposed) return;
      if (this.view.hasChanges()) {
        this.host.step(this.ref);
        return;
      }
    }
    // Round within the file it started from, its folds kept where no other file was drawn meanwhile.
    if (this.ref === start) {
      this.view.goRound(delta);
      return;
    }
    this.ref = start;
    await this.view.show(start.file, delta > 0 ? 'first' : 'last');
  }

  private async look(): Promise<{ dir: string; fingerprint: string } | null> {
    const tree = await window.claudeUi.panelTree(this.ref.root);
    return tree.kind === 'tree' ? { dir: this.ref.root, fingerprint: tree.fingerprint } : null;
  }

  /** The checkout changed: read its changed files again for the question asked, and the file with them, or say it has nothing left to compare. */
  private async reread(): Promise<void> {
    this.reading = true;
    const read = await window.claudeUi.diffSummary(this.ref.root, this.ref.diff.question);
    this.reading = false;
    if (this.disposed) return;
    if (read.kind === 'summary' && read.summary.against) {
      const summary = read.summary;
      const file: DiffFile | undefined = summary.files.find((each) => each.path === this.ref.file.path);
      this.ref = { ...this.ref, diff: { ...this.ref.diff, against: summary.against! }, files: summary.files, file: file ?? this.ref.file };
      this.view.refreshed(this.ref.file);
      // Kept with the tab too, so the next draw of the tab shows this comparison rather than the one it was opened with.
      this.host.refreshed(this.ref);
    }
    this.watch.settle(await this.look());
  }
}
