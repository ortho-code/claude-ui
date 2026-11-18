import { DEFAULT_DIFF_PICKS, type DiffPicks, type DiffQuestion, type DiffSummary } from '../../../../shared/diff/types';
import { store } from '../../../state/app';
import { editorTabsOnShow, openInEditor } from '../../../state/editor-tabs';
import type { MountedPanel, PanelHost, PanelView } from '../../contract';
import type { PanelSlot } from '../../layout';
import { CWD_OPTION, optionsOf, type OptionsDecl } from '../../options';
import { NO_CONTEXT, RunGate, prepare, resolveContext, runKey, type Watched } from '../../run';
import { TreeWatch } from '../../tree-watch';
import { Driven, GateDriver } from '../../gate-driver';
import { element } from '../../../ui/dom';
import { FileList, type FilesView } from './files';
import { QUESTION_NAMES, Toolbar } from './toolbar';
import './panel.css';

/**
 * The diff panel: the files that changed in the checkout it looks in, as a flat list or a tree, for one of three questions.
 * A press on a file opens its diff in the Editor, a preview there unless it was a double click, with the list's order to step through; the row of the file the Editor shows is marked.
 * With no Editor to open in, a layout that leaves it off, the press marks the row and says once where files open (decided 2026-11-18, to be revisited after use).
 *
 * WHEN IT READS, through the gate every panel that runs something goes through (`RunGate`): on first being shown, on Refresh, on a context change once it has read, shown or not; and, unasked, when the checkout's working tree changes (`TreeWatch`), and when the session on show ends a turn, so the list catches up while you work beside it.
 * Each read checks the panel first (`prepare`), so it reads where the header says it looks.
 */

export const DIFF_OPTIONS: OptionsDecl = { name: 'diff', options: [CWD_OPTION], exactlyOne: [] };

/** The list's two views, which the panel's header switches between and the app keeps per panel, as a list panel's are. */
const VIEWS: PanelView[] = [
  { id: 'flat', label: 'Flat list', icon: 'list' },
  { id: 'tree', label: 'File tree', icon: 'tree' },
];

/** How long the session on show has to stay as it is before a turn's end reads the list again, so the changes of one moment, its status and what it wrote, are one read. */
const SETTLE_MS = 2_000;

/** What the list says, once, when a file is pressed with no Editor to open it in. */
const NO_EDITOR = 'Files open in the Editor, which this layout switches off.';

/** What the list says in place of files, by question, when there are none. */
const NOTHING: Record<DiffQuestion, (summary: DiffSummary) => string> = {
  since: (summary) => `Nothing changed since ${summary.base?.ref ?? 'the base'}.`,
  unpushed: () => 'Nothing to push.',
  uncommitted: () => 'Nothing uncommitted.',
};

export class DiffPanel extends Driven implements MountedPanel {
  readonly el = element('div', 'panel-body diff-panel');
  private readonly note = element('p', 'pane-placeholder diff-note');
  private readonly files = new FileList((path, keep) => this.pickFile(path, keep));
  private readonly toolbar: Toolbar;
  private readonly gate: RunGate;
  private readonly tree: TreeWatch;
  private readonly stopWatchingSessions: () => void;
  private readonly stopWatchingEditor: () => void;
  private picks: DiffPicks = DEFAULT_DIFF_PICKS;
  private summary: DiffSummary | null = null;
  /** Why the latest read failed, as git said it; null after one that did not. */
  private failure: string | null = null;
  /** The file pressed while no Editor was on, which its row marks; null once the Editor shows one. */
  private pressed: string | null = null;
  /** Whether the list has said where files open, which it says once. */
  private saidNoEditor = false;
  /** Whether the panel passed its last check; null until the first has answered. */
  private runnable: boolean | null = null;
  /** The number of the read under way, or null for none: what it changes itself is no change to the tree. */
  private reading: number | null = null;
  /** The checkout the latest read looked in. */
  private dir: string | null = null;
  protected readonly driver: GateDriver;
  private disposed = false;
  /** The status of the session on show, last seen; undefined before the first look, so the first is no change. */
  private sessionStatus: string | null | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
  ) {
    super();
    this.toolbar = new Toolbar(
      () => this.picks.question,
      () => this.summary,
      (question) => this.pickQuestion(question),
    );
    this.el.append(this.toolbar.el, this.files.el, this.note);
    this.gate = new RunGate(
      () => runKey(optionsOf(this.slot.entry).cwd, resolveContext(this.host.where())),
      (number) => void this.read(number),
    );
    this.tree = new TreeWatch({
      watching: () => true,
      runnable: () => this.runnable === true,
      running: () => this.reading !== null,
      look: () => this.look(),
      changed: () => this.gate.changed(),
    });
    this.driver = new GateDriver(this.gate, { check: () => this.check(), runnable: () => this.runnable, wentLive: () => this.tree.start() });
    this.stopWatchingSessions = host.watchSessions(() => this.sessionsMoved());
    this.stopWatchingEditor = store.watch(['editorTabs', 'editorOn'], () => this.editorMoved());
    host.setViews(VIEWS);
    this.say('Counting the changed files…');
    void this.loadPicks();
    // Checked at once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.check();
  }

  unmount(): void {
    this.disposed = true;
    this.gate.stop();
    this.tree.stop();
    this.stopWatchingSessions();
    this.stopWatchingEditor();
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
  }

  /** The question kept for this panel, once its data has been read; a list read before then with another question is read again. */
  private async loadPicks(): Promise<void> {
    const kept = (await window.claudeUi.getPanelData(this.slot.key)).diff;
    if (this.disposed || !kept) return;
    const asked = this.picks;
    this.picks = kept;
    this.toolbar.draw();
    if (this.summary && kept.question !== asked.question) this.gate.refresh();
  }

  private pickQuestion(question: DiffQuestion): void {
    if (question === this.picks.question) return;
    this.picks = { ...this.picks, question };
    void window.claudeUi.setDiffPicks(this.slot.key, this.picks);
    this.toolbar.draw();
    this.gate.refresh();
  }

  /** Open the file pressed in the Editor, with the list's order to step through; with no Editor on, mark its row and say once where files open. */
  private pickFile(path: string, keep: boolean): void {
    const summary = this.summary;
    const file = summary?.files.find((each) => each.path === path);
    if (!summary?.against || !file) return;
    if (!store.get().editorOn) {
      this.pressed = path;
      this.saidNoEditor = true;
      this.drawRows();
      return;
    }
    const byPath = new Map(summary.files.map((each) => [each.path, each]));
    const files = this.files.order().flatMap((each) => byPath.get(each) ?? []);
    openInEditor({ root: summary.root, file, diff: { question: this.picks.question, against: summary.against }, files }, keep);
  }

  /** The file the Editor shows for the tab on show, by its path in this checkout; or the one pressed while it was off. */
  private picked(): string | null {
    const root = this.summary?.root;
    const set = editorTabsOnShow();
    const shown = set.tabs.find((tab) => tab.key === set.active);
    if (store.get().editorOn) return shown && shown.ref.root === root ? shown.ref.file.path : null;
    return this.pressed;
  }

  /** The Editor's tabs changed, or it came or went: mark the row it shows, and drop the note once it is back. */
  private editorMoved(): void {
    if (store.get().editorOn) {
      this.pressed = null;
      this.saidNoEditor = false;
    }
    if (this.summary) this.drawRows();
  }

  /** Check the options against the selection as it is now, and tell the host what is wrong and where the panel looks; null once the panel is gone. */
  private async check(): Promise<{ problems: string[]; dir: string | null } | null> {
    const { problems, run, folder } = await prepare(optionsOf(this.slot.entry), DIFF_OPTIONS, this.host.where());
    if (this.disposed) return null;
    this.runnable = problems.length === 0;
    this.host.setProblems(problems);
    this.host.setFolder(folder ?? null);
    return { problems, dir: run?.cwd ?? null };
  }

  /** Read the list for read `number`, checking first; only the latest read draws, and its end gives the tree watch its baseline. */
  private async read(number: number): Promise<void> {
    this.reading = number;
    const checked = await this.check();
    if (!checked || !this.gate.isLatest(number)) return;
    if (checked.problems.length || checked.dir === null) {
      this.reading = null;
      if (checked.dir === null && !checked.problems.length) this.idle();
      if (!checked.problems.length) this.gate.ended(number);
      return;
    }
    this.host.setBusy(true);
    const read = await window.claudeUi.diffSummary(checked.dir, this.picks.question);
    if (this.disposed || !this.gate.isLatest(number)) return;
    this.host.setBusy(false);
    this.summary = read.kind === 'summary' ? read.summary : null;
    // The whole checkout is watched, since the diff covers it, whatever subfolder the panel looks in.
    this.dir = this.summary?.root ?? checked.dir;
    this.draw(read.kind === 'failed' ? read.error : null);
    this.tree.settle(await this.look());
    if (this.gate.isLatest(number)) this.reading = null;
    this.gate.ended(number);
  }

  /** The checkout's working tree as it is now, for the watch; null when it cannot be looked at. */
  private async look(): Promise<Watched | null> {
    const dir = this.dir;
    if (dir === null) return null;
    const tree = await window.claudeUi.panelTree(dir);
    return tree.kind === 'tree' ? { dir, fingerprint: tree.fingerprint } : null;
  }

  /** A panel that can run with nowhere to run: it says so, as a command panel does. */
  private idle(): void {
    this.summary = null;
    this.dir = null;
    this.pressed = null;
    this.toolbar.draw();
    this.files.draw([], this.view(), null);
    this.host.setCount(null);
    this.say(NO_CONTEXT);
  }

  private draw(failure: string | null): void {
    this.failure = failure;
    this.toolbar.draw();
    this.host.setStatus(failure ? 'fail' : null);
    this.host.setCount(this.summary ? this.summary.files.length : null);
    this.drawRows();
  }

  /** The rows, the one the Editor shows marked, and what the list says under them. */
  private drawRows(): void {
    const files = this.summary?.files ?? [];
    if (this.pressed !== null && !files.some((file) => file.path === this.pressed)) this.pressed = null;
    this.files.draw(files, this.view(), this.picked());
    const failure = this.failure;
    if (failure) this.say(`Git could not read the changes here: ${failure.replace(/\.$/, '')}.`);
    else if (!this.summary) this.say('');
    else if (this.picks.question === 'since' && !this.summary.base) this.say(`No base to measure from: neither upstream nor origin has a default branch, or a develop, main or master branch, here. ${QUESTION_NAMES.unpushed} and ${QUESTION_NAMES.uncommitted} still work.`);
    else if (!files.length) this.say(NOTHING[this.picks.question](this.summary));
    else if (this.saidNoEditor) this.say(NO_EDITOR);
    else this.say(this.summary.untrackedLeftOut ? `And ${this.summary.untrackedLeftOut} more untracked files, not listed.` : '');
  }

  private view(): FilesView {
    return this.host.view() === 'tree' ? 'tree' : 'flat';
  }

  private say(words: string): void {
    this.note.textContent = words;
    this.note.hidden = words === '';
  }

  /** The sessions changed: when the session on show has a status it did not have before, its turn may have ended or begun, so read again once it has stayed as it is for a moment. */
  private sessionsMoved(): void {
    const id = this.host.where().tab?.id;
    const status = id ? (this.host.session(id)?.status ?? null) : null;
    const was = this.sessionStatus;
    this.sessionStatus = status;
    if (was === undefined || was === status || this.disposed) return;
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      if (this.runnable === true && this.dir !== null) this.gate.changed();
    }, SETTLE_MS);
  }
}
