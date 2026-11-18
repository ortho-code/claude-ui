import type { DiffFile, DiffView, FileDiff } from '../../../../../shared/diff/types';
import { element } from '../../../../ui/dom';
import { setMarkup } from '../../../../ui/keyed';
import { openMenu, type MenuItem } from '../../../../ui/menu';
import { chevronIcon } from '../../../../ui/svg';
import { menuCaret } from '../../../../ui/menu-caret';
import { mutedText } from '../../../../ui/muted';
import { languageOf } from '../../../../ui/syntax';
import { HunkDrawer, type Reveal } from './hunks';
import { drawMap, markCursor } from './steps';
import './file-view.css';

/**
 * The diff of the file picked in the list: a header naming it, with the view, the whitespace switch and the stepper, then its hunks with the change map beside them.
 * It reads the file against the commit the list was measured from, so the two describe the same diff.
 */

/** Unchanged lines around each change, as git gives them, before a fold is opened. */
const CONTEXT = 3;

/** How each view is named in the menu and on its button. */
const VIEW_NAMES: Record<DiffView, string> = { fit: 'Fit', split: 'Split', unified: 'Unified' };

/** What the file view asks of its panel. */
export interface FileViewHost {
  /** The checkout and the commit the list was measured from; null before a list has been read. */
  source(): { root: string; against: string } | null;
  view(): DiffView;
  /** Whether the view on show is split, the panel's width deciding for Fit. */
  split(): boolean;
  ignoreWs(): boolean;
  /** The unchanged lines folded back to a few around each change, where the whole file is drawn otherwise. */
  changesOnly(): boolean;
  pickView(view: DiffView): void;
  pickIgnoreWs(ignore: boolean): void;
  pickChangesOnly(changesOnly: boolean): void;
  /** Go to the next or previous file with changes to step through, from the one on show. */
  stepFile(delta: 1 | -1): void;
  /** The file on show's place in the list, counted from one. */
  place(): { at: number; of: number };
}

export class FileView {
  readonly el = element('div', 'diff-file-view');
  private readonly header = element('div', 'diff-file-header');
  private readonly path = element('span', 'diff-file-path');
  private readonly position = element('span', 'diff-position');
  private readonly viewButton = element('button', 'diff-view-button');
  private readonly frame = element('div', 'diff-frame');
  private readonly body = element('div', 'diff-hunks');
  private readonly map = element('div', 'diff-map');
  private readonly note = element('p', 'pane-placeholder diff-file-note');
  private file: DiffFile | null = null;
  private diff: FileDiff | null = null;
  private reveal: Reveal = new Map();
  private context = CONTEXT;
  private openGenerated = false;
  private anchors: HTMLElement[] = [];
  private cursor = 0;
  /** Asked to take the keys before the file was drawn. */
  private wantsKeys = false;
  /** Where to put the stepper once the next file's blocks are drawn, when a step crossed into it. */
  private landing: 'first' | 'last' | null = null;
  /** The latest load, so an earlier one that answers last draws nothing. */
  private loads = 0;

  constructor(private readonly host: FileViewHost) {
    this.viewButton.type = 'button';
    this.viewButton.title = 'How the diff is drawn';
    this.viewButton.addEventListener('click', () => openMenu(this.viewButton, this.viewItems()));
    const readOnly = element('span', 'diff-read-only');
    // Nothing in the Editor edits a file yet, so every file says so.
    readOnly.textContent = 'Read only';
    this.header.append(this.path, element('span', 'diff-grow'), readOnly, this.position, this.stepButton('up', 'Previous change (k)', -1), this.stepButton('down', 'Next change (j)', 1), this.viewButton);
    this.body.tabIndex = 0;
    this.body.addEventListener('keydown', (event) => this.key(event));
    this.frame.append(this.body, this.map);
    this.el.append(this.header, this.frame, this.note);
    new ResizeObserver(() => this.drawMap()).observe(this.body);
    void this.show(null);
  }

  /** The file the list's row picked, or none: read it afresh, folds closed, the stepper on its first change, or its last when a step back arrived here. */
  show(file: DiffFile | null, landing: 'first' | 'last' | null = null): Promise<void> {
    this.file = file;
    this.diff = null;
    this.reveal = new Map();
    this.context = CONTEXT;
    this.openGenerated = false;
    this.cursor = 0;
    this.landing = landing;
    this.header.hidden = !file;
    this.drawPath();
    if (!file) {
      this.body.replaceChildren();
      this.anchors = [];
      this.say('Pick a file to see what changed in it.');
      return Promise.resolve();
    }
    return this.load();
  }

  /** The list was read again: the file on show is read again too, with its folds and its place kept, or dropped when the list no longer has it. */
  refreshed(file: DiffFile | null): void {
    if (!file) {
      void this.show(null);
      return;
    }
    this.file = file;
    void this.load();
  }

  /** Draw again as the view now says, the folds and the place kept. */
  redraw(): void {
    if (this.diff) this.draw();
    else this.redrawButton();
  }

  /** Read the file on show again, as the whitespace switch now says. */
  reload(): void {
    this.reveal = new Map();
    void this.load();
  }

  /** Take the keys, so `j` and `k` step through the file: now when it is drawn, else once it is, since its body is hidden while it is read. */
  focus(): void {
    this.wantsKeys = true;
    this.takeKeys();
  }

  private takeKeys(): void {
    if (!this.wantsKeys || this.frame.hidden || !this.diff) return;
    this.wantsKeys = false;
    this.body.focus({ preventScroll: true });
  }

  /** Whether the file on show has a change to step to, once it has been read. */
  hasChanges(): boolean {
    return this.anchors.length > 0;
  }

  private async load(): Promise<void> {
    const file = this.file;
    const source = this.host.source();
    if (!file || !source) return;
    const load = ++this.loads;
    const diff = await window.claudeUi.diffFile(source.root, source.against, file.path, file.status === 'R' ? file.from : null, this.context, this.host.ignoreWs());
    if (load !== this.loads) return;
    this.diff = diff;
    this.draw();
  }

  private draw(): void {
    this.redrawButton();
    const { diff, file } = this;
    if (!diff || !file) return;
    const said = this.sentence(diff, file);
    this.anchors = [];
    this.say(said ?? '');
    if (said !== null) this.body.replaceChildren();
    else if (file.generated && !this.openGenerated) this.generatedBar(file);
    else {
      this.anchors = new HunkDrawer(this.body, diff, {
        split: this.host.split(),
        whole: !this.host.changesOnly(),
        language: languageOf(file.path),
        reveal: this.reveal,
        redraw: () => this.draw(),
        widen: (lines) => {
          this.context += lines;
          void this.load();
        },
      }).all();
    }
    const last = Math.max(0, this.anchors.length - 1);
    this.cursor = this.landing === 'last' ? last : this.landing === 'first' ? 0 : Math.min(this.cursor, last);
    this.landing = null;
    this.mark();
    this.takeKeys();
  }

  /** What stands in a file's place when it has no rows to show, or null for one that has. */
  private sentence(diff: FileDiff, file: DiffFile): string | null {
    if (diff.binary || file.binary) return 'A binary file: nothing to show.';
    if (diff.hunks.length) return null;
    // With nothing changed, the whole file is the file as it is, where there is one to show.
    if (!this.host.changesOnly() && diff.lines?.length) return null;
    if (file.status === 'U' || file.status === 'A') return 'A new, empty file.';
    if (file.status === 'R') return `Renamed from ${file.from ?? 'elsewhere'}, with nothing else changed.`;
    if (this.host.ignoreWs()) return 'Only whitespace changed here, and whitespace is hidden.';
    return 'No changes against this base.';
  }

  private mark(): void {
    markCursor(this.body, this.anchors, this.cursor);
    this.drawMap();
    const { at, of } = this.host.place();
    const files = of > 1 ? ` · file ${at} of ${of}` : '';
    this.position.textContent = this.anchors.length ? `change ${this.cursor + 1} of ${this.anchors.length}${files}` : files.slice(3);
  }

  /** A generated file is one line until asked for: a lockfile is hundreds of lines nobody reviews, and it pushes the real changes out of sight. */
  private generatedBar(file: DiffFile): void {
    const bar = element('button', 'diff-fold');
    bar.type = 'button';
    bar.title = 'A lockfile, or marked linguist-generated in the repository';
    bar.append(`⋯ generated file, +${file.added} −${file.deleted}, press to show`);
    bar.addEventListener('click', () => {
      this.openGenerated = true;
      this.draw();
    });
    this.body.replaceChildren(bar);
  }

  private drawMap(): void {
    drawMap(this.map, this.body, this.anchors.length, this.cursor, (block) => {
      this.cursor = block;
      this.mark();
    });
  }

  /** Step to the next or previous change, carrying on into the next file with changes, and round from the last to the first. */
  step(delta: 1 | -1): void {
    const next = this.cursor + delta;
    if (next >= 0 && next < this.anchors.length) {
      this.cursor = next;
      this.mark();
      return;
    }
    this.host.stepFile(delta);
  }

  /** Go round within the file on show: to its first change stepping on, its last stepping back. */
  goRound(delta: 1 | -1): void {
    if (!this.anchors.length) return;
    this.cursor = delta > 0 ? 0 : this.anchors.length - 1;
    this.mark();
  }

  private key(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== 'j' && event.key !== 'k') return;
    event.preventDefault();
    this.step(event.key === 'j' ? 1 : -1);
  }

  private stepButton(direction: 'up' | 'down', tip: string, delta: 1 | -1): HTMLButtonElement {
    const button = element('button', 'icon-btn compact');
    button.type = 'button';
    button.title = tip;
    button.setAttribute('aria-label', tip);
    setMarkup(button, chevronIcon(direction, 12));
    button.addEventListener('click', () => this.step(delta));
    return button;
  }

  private viewItems(): MenuItem[] {
    const view = this.host.view();
    const ignore = this.host.ignoreWs();
    return [
      ...(['fit', 'split', 'unified'] as const).map((each) => ({ label: VIEW_NAMES[each], checked: each === view, onSelect: () => this.host.pickView(each) })),
      { label: '', separator: true },
      { label: 'Hide whitespace changes', checked: ignore, onSelect: () => this.host.pickIgnoreWs(!ignore) },
      { label: 'Changes only', checked: this.host.changesOnly(), onSelect: () => this.host.pickChangesOnly(!this.host.changesOnly()) },
    ];
  }

  private redrawButton(): void {
    this.viewButton.replaceChildren(VIEW_NAMES[this.host.view()], menuCaret());
  }

  private drawPath(): void {
    const file = this.file;
    this.path.replaceChildren();
    if (!file) return;
    if (file.status === 'R' && file.from) this.path.append(mutedText(`${file.from} → `));
    const cut = file.path.lastIndexOf('/');
    this.path.append(mutedText(file.path.slice(0, cut + 1)), file.path.slice(cut + 1));
    this.path.title = file.path;
  }

  private say(words: string): void {
    this.note.textContent = words;
    this.note.hidden = words === '';
    this.frame.hidden = words !== '';
  }
}
