import type { DiffFile, SessionFileDiff, SessionStart } from '../../../../../shared/diff/types';
import { unlistedFile, type FileRef, type SessionFileRef } from '../../../../state/editor-tabs';
import { drawnAsPicked, type Doc, type DocHost } from './doc';
import { FileView, WHITESPACE_HIDDEN } from './file-view';

/** What the header says the file is compared with, for each start that has a comparison. */
const MARKS: Partial<Record<SessionStart, string>> = { created: "Since this session's first edit", recorded: "Since this session's first edit" };

/** The line under the header for a start whose changes cannot be shown. */
const NOT_RECORDED = "The text before this session's first edit is not recorded, so its changes cannot be shown; the file is shown as it is now.";

/** What stands in the file's place under Changes only, for each start. */
const UNCHANGED: Record<SessionStart, string> = {
  created: "No changes since this session's first edit.",
  recorded: "No changes since this session's first edit.",
  unknown: 'Nothing to compare with.',
  unwritten: 'This session has not changed this file.',
};

/** What stands in the place of a file no longer on disk, Changes only or not. */
const GONE = 'This file is no longer on disk.';

/**
 * One file's tab in the Editor for a file git has nothing to compare with: its changes since the session first changed it, read from main, which takes the text the file had then from the session's transcript.
 * A file the session never changed, or whose text from then is not recorded, is shown as it is now, the header or a line under it saying which.
 * It is read when opened, and again when the view asks, as for hidden whitespace or more context; nothing watches the file.
 */
export class SessionDoc implements Doc {
  readonly kind = 'session';
  readonly view: FileView;
  /** Where the last read said the changes start, which the words the view shows depend on; null before the first read. */
  private start: SessionStart | null = null;
  /** The last read found the file no longer on disk. */
  private gone = false;
  /** The last read found the file's text unchanged since then, whitespace included. */
  private identical = false;

  constructor(
    private ref: SessionFileRef,
    host: DocHost,
  ) {
    this.view = new FileView({
      read: (_file, context, ignoreWs) => window.claudeUi.sessionFileDiff(this.ref.session, this.ref.path, context, ignoreWs).then((diff) => this.heard(diff)),
      unchanged: () => this.unchanged(host.picks().ignoreWs),
      ...drawnAsPicked(host),
      // One file, so a step past its last change goes round within it.
      stepFile: (delta) => this.view.goRound(delta),
      place: () => ({ at: 1, of: 1 }),
    });
    void this.view.show(fileOf(ref));
  }

  showRef(ref: FileRef): Promise<void> {
    if (ref.kind !== 'session' || (ref.path === this.ref.path && ref.session === this.ref.session)) return Promise.resolve();
    this.ref = ref;
    return this.view.show(fileOf(ref));
  }

  release(): void {}

  /** Why there is nothing to show: the file is gone, or, where its text differs from what there was to compare and whitespace is hidden, only whitespace changed, else what its start says. */
  private unchanged(ignoreWs: boolean): { text: string; whitespace: boolean } {
    if (this.gone) return { text: GONE, whitespace: false };
    const start = this.start ?? 'unwritten';
    const whitespace = ignoreWs && !this.identical && (start === 'created' || start === 'recorded');
    return { text: whitespace ? WHITESPACE_HIDDEN : UNCHANGED[start], whitespace };
  }

  private heard(diff: SessionFileDiff): SessionFileDiff {
    this.start = diff.start;
    this.gone = diff.gone;
    this.identical = diff.identical;
    // A file that is gone says only that, in the view's sentence, since there is nothing left to compare.
    this.view.setMarks(diff.gone ? null : (MARKS[diff.start] ?? null), !diff.gone && diff.start === 'unknown' ? NOT_RECORDED : null);
    return diff;
  }
}

/** The file as the view names it: by its whole path. */
const fileOf = (ref: SessionFileRef): DiffFile => unlistedFile(ref.path);
