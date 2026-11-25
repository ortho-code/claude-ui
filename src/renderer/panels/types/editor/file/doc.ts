import type { DiffFile, DiffView } from '../../../../../shared/diff/types';
import type { EditorUi } from '../../../../../shared/types';
import { isShown, type CheckoutFileRef, type FileRef, type StepFile } from '../../../../state/editor-tabs';
import { checkoutReads, type ChangesRead } from '../../../checkout-reads';
import { FileView, WHITESPACE_HIDDEN, type FileViewHost } from './file-view';

/** What a file's tab asks of the Editor it is in: the picks every tab draws by, and how wide the Editor is. */
export interface DocHost {
  picks(): EditorUi;
  /** Whether the Editor is wide enough for Fit to draw split. */
  wide(): boolean;
  pick(change: Partial<EditorUi>): void;
  /** This tab stepped to another file of its sequence, `ref`, which it already shows. */
  step(ref: FileRef): void;
  /** This tab read its file again, now compared as `ref` says. */
  refreshed(ref: FileRef): void;
}

/** What every tab's file view asks of the Editor alike: how to draw, by the picks the Editor keeps for the window, and how wide it is. */
export function drawnAsPicked(host: DocHost): Pick<FileViewHost, 'view' | 'split' | 'ignoreWs' | 'changesOnly' | 'pickView' | 'pickIgnoreWs' | 'pickChangesOnly'> {
  return {
    view: () => host.picks().view,
    split: () => host.picks().view === 'split' || (host.picks().view === 'fit' && host.wide()),
    ignoreWs: () => host.picks().ignoreWs,
    changesOnly: () => host.picks().changesOnly,
    pickView: (view: DiffView) => host.pick({ view }),
    pickIgnoreWs: (ignoreWs) => host.pick({ ignoreWs }),
    pickChangesOnly: (changesOnly) => host.pick({ changesOnly }),
  };
}

/** A tab of the Editor, whatever kind of file it shows: what the Editor's view holds of it. */
export interface Doc {
  /** The kind of file it shows, which a ref must have for `showRef` to show it. */
  readonly kind: FileRef['kind'];
  readonly view: FileView;
  /** Show `ref`, the tab's file as its opener or a step now names it. */
  showRef(ref: FileRef): Promise<void>;
  /** The tab is closed: stop whatever it follows. */
  release(): void;
}

/**
 * One file's tab in the Editor: its diff against what its opener asked, drawn by the file view, and read again whenever a read of its checkout for its question tells it something new (`checkoutReads`): a change of the checkout's working tree, which is watched while any tab or Explorer follows it, or another reader's read of a newer tree, so it needs no panel beside it.
 * Its sequence steps from file to file as the list it was opened from orders them.
 */
export class FileDoc implements Doc {
  readonly kind = 'checkout';
  readonly view: FileView;
  /** Stops following its checkout's changes for its question. */
  private stopFollowing: () => void;
  private disposed = false;

  constructor(
    private ref: CheckoutFileRef,
    private readonly host: DocHost,
  ) {
    this.view = new FileView({
      read: (file, context, ignoreWs) => window.claudeUi.diffFile(this.ref.root, this.ref.diff.against, file.path, file.status === 'R' ? file.from : null, context, ignoreWs),
      // A file the list counts lines for changed, so with no hunks left only whitespace did; one it counts none for changed nothing at all.
      unchanged: () => {
        const whitespace = host.picks().ignoreWs && this.ref.file.added + this.ref.file.deleted > 0;
        return { text: whitespace ? WHITESPACE_HIDDEN : 'No changes against this base.', whitespace };
      },
      ...drawnAsPicked(host),
      stepFile: (delta) => void this.stepFile(delta),
      place: () => ({ at: this.ref.files.findIndex((step) => isShown(this.ref, step)) + 1, of: this.ref.files.length }),
    });
    this.stopFollowing = this.follow();
    void this.view.show(ref.file);
  }

  /** Show `ref`: the same file read again, compared as it now says, or another file afresh. */
  showRef(ref: FileRef): Promise<void> {
    if (ref === this.ref || ref.kind !== 'checkout') return Promise.resolve();
    const same = ref.root === this.ref.root && ref.file.path === this.ref.file.path && ref.diff.against === this.ref.diff.against;
    this.setRef(ref);
    if (same) {
      this.view.refreshed(ref.file);
      return Promise.resolve();
    }
    return this.view.show(ref.file);
  }

  release(): void {
    this.disposed = true;
    this.stopFollowing();
  }

  /**
   * Step into the next or previous file of the sequence that has a change to step to, round from the last to the first, landing on its first change, or its last when stepping back; a generated file still folded has none.
   * Coming round to the file it started from, with no other to step into, it goes round within that one.
   */
  private async stepFile(delta: 1 | -1): Promise<void> {
    const start = this.ref;
    const files = start.files;
    const from = files.findIndex((step) => isShown(start, step));
    for (let hop = 1; hop <= files.length; hop++) {
      const step = files[(from + delta * hop + files.length * hop) % files.length]!;
      if (isShown(start, step)) break;
      this.setRef(refAt(start, step));
      await this.view.show(step.file, delta > 0 ? 'first' : 'last');
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
    this.setRef(start);
    await this.view.show(start.file, delta > 0 ? 'first' : 'last');
  }

  /** Show `ref` from now on, following its checkout's changes for its question once either is another than the last. */
  private setRef(ref: CheckoutFileRef): void {
    const followed = ref.root === this.ref.root && ref.diff.question === this.ref.diff.question;
    this.ref = ref;
    if (followed) return;
    this.stopFollowing();
    this.stopFollowing = this.follow();
  }

  private follow(): () => void {
    return checkoutReads.follow(this.ref.root, this.ref.diff.question, (read) => this.heard(read));
  }

  /** Its checkout's changes were read again: take the comparison and the file from them, where git gave one. */
  private heard(read: ChangesRead): void {
    if (this.disposed) return;
    if (read.kind === 'summary' && read.summary.against) {
      const against = read.summary.against;
      const summary = read.summary;
      const file: DiffFile | undefined = summary.files.find((each) => each.path === this.ref.file.path);
      const fresh = summary.files.map((each): StepFile => ({ root: summary.root, question: this.ref.diff.question, against, file: each }));
      // This checkout's files take the place its old ones had among the other checkouts'.
      const at = this.ref.files.findIndex((step) => step.root === summary.root);
      const rest = this.ref.files.filter((step) => step.root !== summary.root);
      const files = at < 0 ? [...rest, ...fresh] : [...rest.slice(0, at), ...fresh, ...rest.slice(at)];
      this.ref = { ...this.ref, diff: { ...this.ref.diff, against }, files, file: file ?? this.ref.file };
      this.view.refreshed(this.ref.file);
      // Kept with the tab too, so the next draw of the tab shows this comparison rather than the one it was opened with.
      this.host.refreshed(this.ref);
    }
  }
}

/** `start` moved to `step`: its file, in its checkout, for the question that checkout was read for and against what it was read against. */
function refAt(start: CheckoutFileRef, step: StepFile): CheckoutFileRef {
  return { ...start, root: step.root, file: step.file, diff: { question: step.question, against: step.against } };
}
