import type { DiffQuestion, DiffSummary } from '../../../../shared/diff/types';
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

/** What the list says in place of files, by question, when there are none. */
const NOTHING: Record<DiffQuestion, (summary: DiffSummary) => string> = {
  since: (summary) => `Nothing changed since ${summary.base?.ref ?? 'the base'}.`,
  unpushed: () => 'Nothing to push.',
  uncommitted: () => 'Nothing uncommitted.',
};

export class DiffPanel extends Driven implements MountedPanel {
  readonly el = element('div', 'panel-body diff-panel');
  private readonly note = element('p', 'pane-placeholder diff-note');
  private readonly files = new FileList();
  private readonly toolbar: Toolbar;
  private readonly gate: RunGate;
  private readonly tree: TreeWatch;
  private readonly stopWatchingSessions: () => void;
  private question: DiffQuestion = 'since';
  private summary: DiffSummary | null = null;
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
      () => this.question,
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
    if (this.settleTimer !== null) clearTimeout(this.settleTimer);
  }

  /** The question kept for this panel, once its data has been read; a read that started before then reads again with it. */
  private async loadPicks(): Promise<void> {
    const kept = (await window.claudeUi.getPanelData(this.slot.key)).diff?.question;
    if (this.disposed || !kept || kept === this.question) return;
    this.question = kept;
    this.toolbar.draw();
    if (this.summary) this.gate.refresh();
  }

  private pickQuestion(question: DiffQuestion): void {
    if (question === this.question) return;
    this.question = question;
    this.toolbar.draw();
    void window.claudeUi.setDiffPicks(this.slot.key, { question });
    this.gate.refresh();
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
    const read = await window.claudeUi.diffSummary(checked.dir, this.question);
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
    this.toolbar.draw();
    this.files.draw([], this.view());
    this.host.setCount(null);
    this.say(NO_CONTEXT);
  }

  private draw(failure: string | null): void {
    this.toolbar.draw();
    const files = this.summary?.files ?? [];
    this.files.draw(files, this.view());
    this.host.setStatus(failure ? 'fail' : null);
    this.host.setCount(this.summary ? files.length : null);
    if (failure) this.say(`Git could not read the changes here: ${failure.replace(/\.$/, '')}.`);
    else if (!this.summary) this.say('');
    else if (this.question === 'since' && !this.summary.base) this.say(`No base to measure from: neither upstream nor origin has a default branch, or a develop, main or master branch, here. ${QUESTION_NAMES.unpushed} and ${QUESTION_NAMES.uncommitted} still work.`);
    else if (!files.length) this.say(NOTHING[this.question](this.summary));
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
