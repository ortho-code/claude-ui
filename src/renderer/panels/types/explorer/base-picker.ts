import type { BaseCandidate, BaseLayers, DiffSummary } from '../../../../shared/diff/types';
import type { ClaudeUiApi } from '../../../../shared/types';
import { element } from '../../../ui/dom';
import { flash } from '../../../ui/flash';
import { listen, runModal } from '../../../ui/modal';
import { wordButton } from '../../../ui/word-button';
import { BASE_SOURCE_WORDS } from './questions';
import './base-picker.css';

/**
 * THE BASE PICKER: what Since branched in one checkout is measured from, picked from every local and remote branch of its repository, searched by name.
 * A press selects a row and Save keeps it; a double click on a row, or Enter on one, selects it and saves where that changes anything, and Enter in the search saves what is selected; Save is unavailable while it would change nothing; Cancel and Esc send nothing, and a save already sent is waited for.
 * The selection is kept for the branch the checkout has out; with Use for the whole project ticked, it is kept for the repository's project instead and this branch's own pick is dropped, so this checkout follows it too; Default then drops the project's base as well, so every checkout without its own pick follows the guess.
 * The box ticks nothing when the dialog opens, since it is what Save does rather than a level to look at; a checkout detached when the panel last read it has no branch, so there it is ticked and fixed.
 * A box over the search says what the panel last measured this checkout from and why, and what Save will do, each name a press away from its row; the list opens on the row selected, Default at its top.
 * Each row says how many commits that branch would count as this one's own, asked only once the row scrolls into view, since a repository can have thousands of branches and each count is a walk of its history.
 */

/** What the picker asks main: the branches and what each level keeps, a count per branch, and the keeping. */
export type BasePickerBridge = Pick<ClaudeUiApi, 'diffBaseCandidates' | 'diffBaseCount' | 'diffBaseLayers' | 'setDiffBase'>;

/** A row of the list: a branch by its name, or null for Default. */
type Choice = string | null;

/** What each level keeps once Save is pressed: the branch's own pick and the project's base, null for none. */
interface Outcome {
  branch: Choice;
  project: Choice;
}

/** How many counts are asked at once while rows scroll into view, so a fast scroll queues them rather than starting a walk of the history per row. */
const COUNTS_AT_ONCE = 4;

/** The list's groups, in order: the remotes' default branches, then this repository's own, then the rest of the remotes'. */
const GROUPS: { label: string; holds: (candidate: BaseCandidate) => boolean }[] = [
  { label: 'Default branches', holds: (candidate) => candidate.isDefault },
  { label: 'Local branches', holds: (candidate) => candidate.local },
  { label: 'Remote branches', holds: (candidate) => !candidate.local && !candidate.isDefault },
];

/** The first row's name, which keeps no base of its own. */
const DEFAULT = 'Default';

/** A count as a row says it: still being asked, the ask failing, as when git does not answer, none where main finds no history shared with this branch, a branch gone since the list was read included, or the commits. */
type Count = 'asking' | 'failed' | number | null;

/** What a row says for each count that is no number of commits. */
const COUNT_WORDS = { asking: '…', failed: 'could not count', none: 'no shared history' };

/**
 * Open the picker for the checkout `summary` was read from; true once main has kept or cleared a base, which a save sent before Cancel or Esc closed the dialog is waited for, false when none was kept.
 * The branch the checkout has out is not offered: it would count nothing as its own.
 */
export async function pickBase(summary: DiffSummary, bridge: BasePickerBridge = window.claudeUi): Promise<boolean> {
  const view = new PickerView(summary, bridge);
  document.body.append(view.overlay);
  try {
    const kept = await runModal<boolean>(view.overlay, false, (finish) => view.bind(finish));
    // Closed while main was keeping: what reads it next must read it after main wrote it.
    return kept || (view.saving !== null && (await view.saving));
  } finally {
    view.stop();
    view.overlay.remove();
  }
}

class PickerView {
  readonly overlay = element('div', 'overlay base-picker-overlay');
  private readonly dialog = element('div', 'dialog wide base-picker');
  /** What this checkout measures from now, and what Save will do. */
  private readonly now = element('div', 'base-picker-state');
  private readonly search = element('input', 'dialog-field base-picker-search');
  private readonly whole = element('input', 'base-picker-whole');
  private readonly list = element('div', 'base-picker-list');
  private readonly error = element('p', 'dialog-error');
  private readonly cancel = element('button');
  private readonly save = element('button', 'primary');
  private candidates: BaseCandidate[] | null = null;
  private layers: BaseLayers | null = null;
  /** The row selected; undefined until the branches are read. */
  private selected: Choice | undefined;
  private readonly counts = new Map<string, Count>();
  /** The rows waiting for their count, by ref, the oldest first. */
  private readonly waiting: string[] = [];
  private asking = 0;
  private readonly seen: IntersectionObserver;
  private stopped = false;
  /** The keeping last sent to main, true once main wrote all of it, and on a refusal whether it wrote any part first, which closing the dialog cannot take back; null before any. */
  saving: Promise<boolean> | null = null;

  constructor(
    private readonly summary: DiffSummary,
    private readonly bridge: BasePickerBridge,
  ) {
    this.seen = new IntersectionObserver((entries) => this.cameIntoView(entries), { root: this.list });
    this.overlay.hidden = true;
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.setAttribute('aria-labelledby', 'base-picker-title');
    const title = element('p', 'dialog-title');
    title.id = 'base-picker-title';
    title.textContent = 'Measure Since branched from';
    const which = element('p', 'dialog-detail base-picker-which');
    which.textContent = `For ${summary.branch ?? 'this checkout, which has no branch out'}`;
    which.title = summary.root;
    this.search.type = 'search';
    this.search.placeholder = 'Search branches';
    this.search.setAttribute('aria-label', 'Search branches');
    this.search.autocomplete = 'off';
    this.list.setAttribute('role', 'listbox');
    this.list.textContent = 'Reading the branches…';
    this.error.hidden = true;
    this.cancel.type = 'button';
    this.cancel.textContent = 'Cancel';
    this.save.type = 'button';
    this.save.textContent = 'Save';
    this.save.disabled = true;
    const actions = element('div', 'dialog-actions base-picker-actions');
    actions.append(this.cancel, this.save);
    this.dialog.append(title, which, this.now, this.search, this.list, this.wholeChoice(), this.error, actions);
    this.overlay.append(this.dialog);
  }

  /** Wire the controls and read the branches; what it returns unbinds them. */
  bind(finish: (kept: boolean) => void): (() => void)[] {
    this.search.focus();
    void this.load();
    const keep = (): void => this.keep(finish);
    return [
      listen(this.search, 'input', () => this.draw()),
      listen(this.whole, 'change', () => this.drawState()),
      listen(this.cancel, 'click', () => finish(false)),
      listen(this.save, 'click', keep),
      listen(this.list, 'click', (event) => this.select(rowOf(event.target))),
      listen(this.list, 'dblclick', (event) => {
        const row = rowOf(event.target);
        if (!row) return;
        this.select(row);
        keep();
      }),
      // Enter in the search or on a row saves what is selected, a row with the keys selected first; on a button or the checkbox it presses that as usual.
      listen(this.dialog, 'keydown', (event) => {
        if (event.key !== 'Enter' || (event.target !== this.search && !rowOf(event.target))) return;
        event.preventDefault();
        this.select(rowOf(event.target));
        keep();
      }),
    ];
  }

  stop(): void {
    this.stopped = true;
    this.seen.disconnect();
  }

  private detached(): boolean {
    return this.summary.branch === null;
  }

  /** What a level keeps, a gone one included, so dropping it is a change. */
  private kept(level: 'branch' | 'project'): Choice {
    return this.layers?.[level]?.ref ?? null;
  }

  /** The project's base while it is in use, null while the project keeps none or only one that is gone. */
  private projectInUse(): Choice {
    const project = this.layers?.project;
    return project && !project.gone ? project.ref : null;
  }

  /** What each level keeps once Save is pressed. */
  private outcome(): Outcome {
    const selected = this.selected ?? null;
    if (this.whole.checked) return { branch: null, project: selected };
    return { branch: selected, project: this.kept('project') };
  }

  private changes(): boolean {
    if (this.selected === undefined) return false;
    const after = this.outcome();
    return after.branch !== this.kept('branch') || after.project !== this.kept('project');
  }

  /** What Default stands for: the project's base in use, unless Save drops it, else the guess. */
  private fallback(): { short: string; whole: string } {
    const project = this.whole.checked ? null : this.projectInUse();
    if (project) return { short: `the project's · ${project}`, whole: `the project's base, ${project}` };
    const guess = this.layers?.guess ?? 'none found';
    return { short: `the guess · ${guess}`, whole: `the guess, ${guess}` };
  }

  /** Select the row `row` stands for; nothing for no row. */
  private select(row: HTMLElement | null): void {
    if (!row || this.list.inert) return;
    this.selected = row.dataset.ref ?? null;
    this.drawState();
  }

  /** Keep what Save would: at the project's level, dropping this branch's own pick, or at the branch's. */
  private keep(finish: (kept: boolean) => void): void {
    if (this.save.disabled || this.selected === undefined) return;
    this.error.hidden = true;
    this.busy(true);
    const after = this.outcome();
    const root = this.summary.root;
    // Whether main has kept anything yet: a first keeping can go through before a second fails, which the checkouts must then be read again for.
    let keptAny = false;
    const send = async (): Promise<void> => {
      if (after.project !== this.kept('project')) {
        await this.bridge.setDiffBase(root, 'project', after.project);
        keptAny = true;
      }
      if (after.branch !== this.kept('branch')) await this.bridge.setDiffBase(root, 'branch', after.branch);
    };
    this.saving = send().then(
      () => {
        finish(true);
        return true;
      },
      (error: unknown) => {
        this.busy(false);
        this.fail(`Could not keep the base: ${error instanceof Error ? error.message : String(error)}`);
        return keptAny;
      },
    );
  }

  /** While main keeps a base, nothing else is pressed. */
  private busy(on: boolean): void {
    this.list.inert = on;
    this.save.disabled = on;
    this.whole.disabled = on || this.detached();
  }

  /** Use for the whole project, unticked on opening, since it says what Save does; ticked and fixed for a detached checkout, which has no branch to keep a base for. */
  private wholeChoice(): HTMLElement {
    const choice = element('label', 'dialog-choice base-picker-whole-choice');
    this.whole.type = 'checkbox';
    this.whole.checked = this.detached();
    this.whole.disabled = this.detached();
    const words = element('span');
    const note = element('span', 'dialog-detail');
    note.textContent = this.detached() ? 'This checkout has no branch out, so a base is kept for the project.' : 'Every checkout of this repository, this one included: its own pick is dropped.';
    words.append('Use for the whole project', note);
    choice.append(this.whole, words);
    return choice;
  }

  private async load(): Promise<void> {
    try {
      const [all, layers] = await Promise.all([this.bridge.diffBaseCandidates(this.summary.root), this.bridge.diffBaseLayers(this.summary.root)]);
      if (this.stopped) return;
      this.candidates = all.filter((candidate) => !(candidate.local && candidate.ref === this.summary.branch));
      this.layers = layers;
      const own = layers.branch;
      this.selected = own && !own.gone && !this.detached() ? own.ref : this.detached() ? this.projectInUse() : null;
      this.draw();
      this.reveal(this.selected, false);
    } catch (error) {
      if (!this.stopped) this.fail(`Could not list the branches: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private fail(words: string): void {
    this.error.textContent = words;
    this.error.hidden = false;
  }

  /** Default, while the search is empty or names it, then the branches whose name holds what is searched, in their groups, each by name. */
  private draw(): void {
    if (!this.candidates || !this.layers) return;
    this.seen.disconnect();
    const asked = this.search.value.trim().toLowerCase();
    const matching = this.candidates.filter((candidate) => candidate.ref.toLowerCase().includes(asked));
    const out: HTMLElement[] = [];
    if (DEFAULT.toLowerCase().includes(asked)) out.push(heading(DEFAULT), this.defaultRow());
    for (const group of GROUPS) {
      const held = matching.filter(group.holds).sort((a, b) => a.ref.localeCompare(b.ref));
      if (held.length) out.push(heading(group.label), ...held.map((candidate) => this.row(candidate)));
    }
    if (!out.length) {
      const none = element('p', 'base-picker-none');
      none.textContent = this.candidates.length ? 'No branch matches.' : 'This repository has no other branch.';
      out.push(none);
    }
    this.list.replaceChildren(...out);
    this.drawState();
  }

  /**
   * Bring the row of `choice` into view and flash it, clearing a search that hides it: Default at the list's top, a branch in the middle.
   * `mark` flashes it, as a press on its name in the box does; the list opening on its row does not.
   */
  private reveal(choice: Choice, mark: boolean): void {
    const find = (): HTMLElement | undefined => [...this.list.querySelectorAll<HTMLElement>('.base-picker-row')].find((row) => (row.dataset.ref ?? null) === choice);
    if (!find() && this.search.value) {
      this.search.value = '';
      this.draw();
    }
    const row = find();
    if (!row) return;
    this.list.scrollTop = choice === null ? 0 : row.offsetTop - this.list.offsetTop - (this.list.clientHeight - row.offsetHeight) / 2;
    if (mark) flash(row);
  }

  /** What changes with the selection and the box, the rows staying where they are: which row is selected, what Default stands for, the box over the search, and Save. */
  private drawState(): void {
    if (!this.layers || this.selected === undefined) return;
    for (const row of this.list.querySelectorAll<HTMLElement>('.base-picker-row')) {
      const selected = (row.dataset.ref ?? null) === this.selected;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-selected', String(selected));
      row.querySelector('.base-picker-tick')!.textContent = selected ? '✓' : '';
    }
    const defaultRow = this.list.querySelector<HTMLElement>('.base-picker-default');
    if (defaultRow) {
      defaultRow.querySelector('.base-picker-count')!.textContent = this.fallback().short;
      defaultRow.title = `${DEFAULT}: no base of its own here, so it follows ${this.fallback().whole}.`;
    }
    this.save.disabled = !this.changes() || this.list.inert;
    this.drawNow();
  }

  /** The box over the search: what the panel last measured this checkout from and why, and what Save will do, or No change, with Undo. */
  private drawNow(): void {
    const base = this.summary.base;
    const gone = this.summary.missing ? `; ${this.summary.missing} is gone` : '';
    const inUse = base ? this.goTo(base.ref) : textOf('no base to measure from');
    const why = base ? `${BASE_SOURCE_WORDS[base.source]}${gone}` : `Neither upstream nor origin has a default branch here${gone}.`;
    const changed = this.changes();
    const after = this.outcome();
    // A project's base that is gone gives way to the guess, as main's own order does.
    const project = after.project === this.kept('project') ? this.projectInUse() : after.project;
    const target = after.branch ?? project ?? this.layers?.guess ?? null;
    const changedTo = changed ? (target ? this.goTo(target) : textOf('no base to measure from')) : textOf('No change', 'base-picker-unchanged');
    const undo = element('button', 'base-picker-undo');
    undo.type = 'button';
    undo.textContent = 'Undo';
    undo.hidden = !changed;
    undo.addEventListener('click', () => this.undo());
    this.now.replaceChildren(textOf('In use', 'base-picker-label'), this.line(inUse, why), element('span'), textOf('Changed to', 'base-picker-label'), this.line(changedTo, changed ? this.effect(after) : ''), undo);
  }

  /** A line of the box: a name, and under it what it means, two lines high whatever it says, so the list under the box keeps its place. */
  private line(name: HTMLElement, words: string): HTMLElement {
    const line = element('span', 'base-picker-line');
    const what = element('span', 'base-picker-what');
    what.textContent = words;
    what.title = words;
    line.append(name, what);
    return line;
  }

  /** A branch's name in the box, a press away from its row; one the list does not hold, such as a base that is gone, goes to Default's. */
  private goTo(name: string): HTMLElement {
    const button = wordButton('base-picker-goto');
    button.textContent = name;
    button.title = `${name}: show it in the list`;
    button.addEventListener('click', () => this.reveal(this.candidates?.some((candidate) => candidate.ref === name) ? name : null, true));
    return button;
  }

  /** What Save will do, in full. */
  private effect(after: Outcome): string {
    const dropped = this.kept('branch') !== null && after.branch === null ? `; this branch's own pick, ${this.kept('branch')}, is dropped` : '';
    if (this.whole.checked) {
      if (after.project === null) return `Every checkout of this repository without its own pick follows ${this.fallback().whole}${dropped}.`;
      return `Every checkout of this repository without its own pick measures from it${dropped}.`;
    }
    if (after.branch === null) return `This branch's own pick is dropped; it follows ${this.fallback().whole}.`;
    return 'This branch measures from it.';
  }

  /** Put the selection and the box back as they were on opening, and the list on that row. */
  private undo(): void {
    this.whole.checked = this.detached();
    const own = this.layers?.branch;
    this.selected = own && !own.gone && !this.detached() ? own.ref : this.detached() ? this.projectInUse() : null;
    this.drawState();
    this.reveal(this.selected, true);
  }

  /** The first row, Default: no base of its own, with what it then follows where a branch's count stands. */
  private defaultRow(): HTMLElement {
    const row = this.choiceRow(DEFAULT, false);
    row.classList.add('base-picker-default');
    return row;
  }

  private row(candidate: BaseCandidate): HTMLElement {
    const row = this.choiceRow(candidate.ref, true);
    row.dataset.ref = candidate.ref;
    this.fillCount(row);
    if (!this.counts.has(candidate.ref)) this.seen.observe(row);
    return row;
  }

  /** A row of the list: the tick of the selection, the name, and the count or what Default stands for. */
  private choiceRow(label: string, isRef: boolean): HTMLElement {
    const row = element('button', 'base-picker-row');
    row.type = 'button';
    row.setAttribute('role', 'option');
    const name = element('span', isRef ? 'base-picker-ref' : 'base-picker-ref base-picker-words');
    name.textContent = label;
    row.append(element('span', 'base-picker-tick'), name, element('span', 'base-picker-count'));
    return row;
  }

  /** A row's count as it stands, and its tooltip, which names the branch whole, since the row may cut it, and what it would count. */
  private fillCount(row: HTMLElement): void {
    const ref = row.dataset.ref!;
    // A count of null is an answer, no shared history, so only a count not yet asked reads as asking.
    const asked = this.counts.get(ref);
    const count: Count = asked === undefined ? 'asking' : asked;
    const cell = row.querySelector<HTMLElement>('.base-picker-count')!;
    cell.classList.toggle('asking', count === 'asking');
    cell.textContent = typeof count === 'number' ? `${count} commit${count === 1 ? '' : 's'}` : COUNT_WORDS[count ?? 'none'];
    const told = typeof count === 'number' ? `would count ${cell.textContent} as this branch's own` : count === null ? 'shares no history with this branch' : count === 'failed' ? 'could not be counted' : 'still being counted';
    row.title = `${ref}: ${told}.`;
  }

  private cameIntoView(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      this.seen.unobserve(entry.target);
      const ref = (entry.target as HTMLElement).dataset.ref!;
      if (this.counts.has(ref)) continue;
      this.counts.set(ref, 'asking');
      this.waiting.push(ref);
    }
    this.askNext();
  }

  /** Ask the next waiting counts, at most `COUNTS_AT_ONCE` under way; an ask that fails says so. */
  private askNext(): void {
    while (!this.stopped && this.asking < COUNTS_AT_ONCE && this.waiting.length) {
      const ref = this.waiting.shift()!;
      this.asking++;
      this.bridge
        .diffBaseCount(this.summary.root, ref)
        .then(
          (count) => this.counts.set(ref, count),
          () => this.counts.set(ref, 'failed'),
        )
        .finally(() => {
          this.asking--;
          const row = this.list.querySelector<HTMLElement>(`.base-picker-row[data-ref="${CSS.escape(ref)}"]`);
          if (row) this.fillCount(row);
          this.askNext();
        });
    }
  }
}

/** The row of the list an event happened in, if any. */
function rowOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('.base-picker-row') : null;
}

/** A group's heading in the list. */
function heading(label: string): HTMLElement {
  const el = element('div', 'base-picker-group');
  el.textContent = label;
  return el;
}

/** Words in the box where a name would stand. */
function textOf(words: string, className = 'base-picker-unnamed'): HTMLElement {
  const el = element('span', className);
  el.textContent = words;
  return el;
}
