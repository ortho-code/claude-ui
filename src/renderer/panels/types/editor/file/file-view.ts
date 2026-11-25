import type { DiffFile, DiffView, FileDiff } from '../../../../../shared/diff/types';
import { element } from '../../../../ui/dom';
import { setMarkup } from '../../../../ui/keyed';
import { openMenu, type MenuItem } from '../../../../ui/menu';
import { chevronIcon } from '../../../../ui/svg';
import { menuCaret } from '../../../../ui/menu-caret';
import { mutedText } from '../../../../ui/muted';
import { languageOf } from '../../../../ui/syntax';
import { flash } from '../../../../ui/flash';
import '../../../../ui/decisive-button.css';
import { foldHolding, HunkDrawer, type Reveal } from './hunks';
import { drawMap, markCursor } from './steps';
import './file-view.css';

/**
 * The diff of one file: a header naming it, over the view, the whitespace and Changes only switches and the stepper, then its hunks with the change map beside them.
 * What the file is compared with is its host's to say: the view asks its host to read the file, and draws what comes back.
 */

/** Unchanged lines around each change, as git gives them, before a fold is opened. */
const CONTEXT = 3;

/** What a file says when its only changes are in whitespace, which is hidden. */
export const WHITESPACE_HIDDEN = 'Only whitespace changed here, and whitespace is hidden.';

/** A sentence in a file's place, and the pick that, switched off, would show something instead: Changes only, or hidden whitespace; null where none would. */
interface Said {
  text: string;
  lift: 'changesOnly' | 'ignoreWs' | null;
}

/** The button each pick's sentence offers, which switches it off. */
const LIFTS = { changesOnly: 'Show the whole file', ignoreWs: 'Show whitespace changes' } as const;

/** How each view is named in the menu and on its button. */
const VIEW_NAMES: Record<DiffView, string> = { fit: 'Fit', split: 'Split', unified: 'Unified' };

/** What the file view asks of the tab it is in. */
export interface FileViewHost {
  /** `file`'s hunks, with `context` unchanged lines around each change and whitespace-only changes left out with `ignoreWs`, and the file as it is now. */
  read(file: DiffFile, context: number, ignoreWs: boolean): Promise<FileDiff>;
  view(): DiffView;
  /** What stands in the file's place when it has no change to show and Changes only is on, or nothing to show at all: why, in words, `WHITESPACE_HIDDEN` with `whitespace` where hiding whitespace is what left nothing. */
  unchanged(): { text: string; whitespace: boolean };
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
  private readonly whitespaceToggle = this.toggle('Hide whitespace', 'Leave out changes that only touch whitespace', () => this.host.pickIgnoreWs(!this.host.ignoreWs()));
  private readonly changesOnlyToggle = this.toggle('Changes only', 'Fold the unchanged lines between changes', () => this.host.pickChangesOnly(!this.host.changesOnly()));
  /** What the file is compared with, where its tab says so. */
  private readonly comparedWith = element('span', 'diff-file-mark');
  /** A line under the header saying why the file's changes cannot be shown, where its tab says so. */
  private readonly notice = element('p', 'diff-file-notice');
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
  /** A line to bring into sight once the file is drawn, taken by the first draw that has it. */
  private revealAt: number | null = null;
  /** The load the drawn diff came from; behind `loads` while a read is under way, whose draw puts the stepper back on its change. */
  private drawnLoad = 0;
  /** The sentence on show offers a pick to switch off, which would draw the file's lines. */
  private lifting = false;

  constructor(private readonly host: FileViewHost) {
    this.viewButton.type = 'button';
    this.viewButton.title = 'How the diff is drawn';
    this.viewButton.addEventListener('click', () => openMenu(this.viewButton, this.viewItems()));
    const readOnly = element('span', 'diff-read-only');
    // Nothing in the Editor edits a file yet, so every file says so.
    readOnly.textContent = 'Read only';
    const title = element('div', 'diff-file-title');
    title.append(this.path, element('span', 'diff-grow'), this.comparedWith, readOnly);
    const steps = element('div', 'diff-steps');
    steps.append(this.position, this.stepButton('up', 'Previous change (k)', -1), this.stepButton('down', 'Next change (j)', 1));
    const controls = element('div', 'diff-file-controls');
    controls.append(this.viewButton, this.whitespaceToggle, this.changesOnlyToggle, steps);
    this.header.append(title, controls);
    this.body.tabIndex = 0;
    this.body.addEventListener('keydown', (event) => this.key(event));
    this.frame.append(this.body, this.map);
    this.el.append(this.header, this.notice, this.frame, this.note);
    new ResizeObserver(() => this.drawMap()).observe(this.body);
    this.setMarks(null, null);
    void this.show(null);
  }

  /** Say in the header what the file is compared with, and under it why its changes cannot be shown; null for neither. */
  setMarks(mark: string | null, notice: string | null): void {
    this.comparedWith.textContent = mark ?? '';
    this.comparedWith.hidden = mark === null;
    this.notice.textContent = notice ?? '';
    this.notice.hidden = notice === null;
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
      this.say({ text: 'Pick a file to see what changed in it.', lift: null });
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
    if (!file) return;
    const load = ++this.loads;
    const diff = await this.host.read(file, this.context, this.host.ignoreWs());
    if (load !== this.loads) return;
    this.diff = diff;
    this.drawnLoad = load;
    this.draw();
  }

  private draw(): void {
    this.redrawButton();
    const { diff, file } = this;
    if (!diff || !file) return;
    const said = this.sentence(diff, file);
    this.anchors = [];
    this.say(said);
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
    this.bringIntoSight();
  }

  /** Bring line `line` of the file as it is now into sight, marked for a moment: now when the file is drawn, else once it is. */
  revealLine(line: number): void {
    this.revealAt = line;
    this.bringIntoSight();
  }

  /**
   * The line asked for, in the middle of the view; one inside a fold opens that fold first.
   * A file that says a sentence instead of its lines has none to show: the ask waits while its sentence offers a pick to switch off, which draws the lines, and goes otherwise.
   * While the file is read again the ask waits for that read's draw, which would otherwise scroll back to the stepper's change.
   */
  private bringIntoSight(): void {
    const line = this.revealAt;
    if (line === null || !this.diff || this.drawnLoad !== this.loads || this.lifting) return;
    this.revealAt = null;
    if (!this.frame.hidden && this.host.changesOnly()) {
      const fold = foldHolding(this.diff, line);
      if (fold) {
        this.reveal.set(fold.index, { top: fold.count, bottom: 0 });
        this.draw();
      }
    }
    const row = this.body.querySelector<HTMLElement>(`[data-line="${line}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    flash(row);
  }

  /** What stands in a file's place when it has no rows to show, or null for one that has. */
  private sentence(diff: FileDiff, file: DiffFile): Said | null {
    const plain = (text: string): Said => ({ text, lift: null });
    if (diff.binary || file.binary) return plain('A binary file: nothing to show.');
    if (diff.hunks.length) return null;
    // With nothing changed, the whole file is the file as it is, where there is one to show.
    if (!this.host.changesOnly() && diff.lines?.length) return null;
    if (file.status === 'U' || file.status === 'A') return plain('A new, empty file.');
    if (file.status === 'R') return plain(`Renamed from ${file.from ?? 'elsewhere'}, with nothing else changed.`);
    const { text, whitespace } = this.host.unchanged();
    return { text, lift: whitespace ? 'ignoreWs' : this.host.changesOnly() && diff.lines?.length ? 'changesOnly' : null };
  }

  private mark(): void {
    markCursor(this.body, this.anchors, this.cursor);
    this.drawMap();
    const { at, of } = this.host.place();
    const change = this.anchors.length ? { at: this.cursor + 1, of: this.anchors.length } : null;
    const file = of > 1 ? { at, of } : null;
    const long = [change && `change ${change.at} of ${change.of}`, file && `file ${file.at} of ${file.of}`].filter(Boolean).join(' · ');
    const short = [change, file].filter((each) => each !== null).map((each) => `${each.at}/${each.of}`).join(' · ');
    const longForm = element('span', 'diff-position-long');
    longForm.textContent = long;
    // What a narrow header shows in its place, the long form staying a hover away.
    const shortForm = element('span', 'diff-position-short');
    shortForm.textContent = short;
    this.position.replaceChildren(longForm, shortForm);
    this.position.title = long;
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

  /** A switch in the header's controls, pressed while it is on. */
  private toggle(label: string, tip: string, press: () => void): HTMLButtonElement {
    const button = element('button', 'pill');
    button.type = 'button';
    button.textContent = label;
    button.title = tip;
    button.addEventListener('click', press);
    return button;
  }

  private viewItems(): MenuItem[] {
    const view = this.host.view();
    return (['fit', 'split', 'unified'] as const).map((each) => ({ label: VIEW_NAMES[each], checked: each === view, onSelect: () => this.host.pickView(each) }));
  }

  private redrawButton(): void {
    this.viewButton.replaceChildren(VIEW_NAMES[this.host.view()], menuCaret());
    for (const [button, on] of [
      [this.whitespaceToggle, this.host.ignoreWs()],
      [this.changesOnlyToggle, this.host.changesOnly()],
    ] as const) {
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
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

  /** Put `said` in the file's place, with a button under it switching off the pick that leaves nothing to show, where one does, as a cold tab's pane offers its ways on; null shows the file. */
  private say(said: Said | null): void {
    this.note.replaceChildren(said?.text ?? '');
    this.lifting = said?.lift != null;
    if (said?.lift) {
      const pick = said.lift;
      const line = element('div');
      line.textContent = said.text;
      // The one way on, so the decisive look, as a cold tab's Resume has.
      const lift = element('button', 'primary');
      lift.type = 'button';
      lift.textContent = LIFTS[pick];
      lift.addEventListener('click', () => (pick === 'changesOnly' ? this.host.pickChangesOnly(false) : this.host.pickIgnoreWs(false)));
      const actions = element('div', 'pane-actions');
      actions.append(lift);
      this.note.replaceChildren(line, actions);
    }
    this.note.hidden = said === null;
    this.frame.hidden = said !== null;
  }
}
