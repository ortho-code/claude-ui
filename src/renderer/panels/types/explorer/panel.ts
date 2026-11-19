import { DEFAULT_DIFF_PICKS, type DiffFile, type DiffPicks, type DiffQuestion, type DiffSummary } from '../../../../shared/diff/types';
import type { SessionSummary } from '../../../../shared/types';
import { store } from '../../../state/app';
import { sessionById } from '../../../state/views';
import { editorTabsOnShow, openInEditor, type StepFile } from '../../../state/editor-tabs';
import type { MountedPanel, PanelHost, PanelView } from '../../contract';
import type { PanelSlot } from '../../layout';
import { CWD_OPTION, optionsOf, type OptionDecl, type OptionsDecl } from '../../options';
import { checkoutReads, type ChangesRead } from '../../checkout-reads';
import { NO_CONTEXT, RunGate, prepare, resolveContext, runKey } from '../../run';
import { Driven, GateDriver } from '../../gate-driver';
import { element } from '../../../ui/dom';
import type { MenuItem } from '../../../ui/menu';
import { FileList, type FilesView, type Placed } from './files';
import { explorerRoots, type ExplorerRoot, type NestedRepository } from './roots';
import { QUESTION_NAMES, Toolbar } from './toolbar';
import './panel.css';

/**
 * The Explorer: the files that changed in the checkout it looks in, as a flat list or a tree, for one of three questions.
 * A press on a file opens its diff in the Editor, a preview there unless it was a double click, with the list's order to step through; the row of the file the Editor shows is marked.
 *
 * WHEN IT READS, through the gate every panel that runs something goes through (`RunGate`): on first being shown, on Refresh, on a context change once it has read, shown or not, and when the session on show ends a turn, so the list catches up while you work beside it.
 * It reads through the window's one set of checkout reads (`checkoutReads`), and follows the checkout git answered for there, for its question: the checkout's working tree changing, or another reader's read of the same checkout and question, redraws it too, unasked.
 * Each read checks the panel first (`prepare`), so it reads where the header says it looks.
 */

/** How the tree draws a chain of folders that each hold only the next: a row per folder (`separate`, the default), or the chain on one row (`combined`), the name and the values a `changes` panel's option has. */
const FOLDERS_OPTION: OptionDecl = { name: 'folders', kind: 'choice', values: ['separate', 'combined'] };

export const EXPLORER_OPTIONS: OptionsDecl = { name: 'explorer', options: [CWD_OPTION, FOLDERS_OPTION], exactlyOne: [] };

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

export class ExplorerPanel extends Driven implements MountedPanel {
  readonly el = element('div', 'panel-body explorer-panel');
  private readonly note = element('p', 'pane-placeholder explorer-note');
  private readonly files = new FileList(
    (file, keep) => this.pickFile(file, keep),
    () => optionsOf(this.slot.entry).folders === 'combined',
  );
  private readonly toolbar: Toolbar;
  private readonly gate: RunGate;
  private readonly stopWatchingSessions: () => void;
  private readonly stopWatchingEditor: () => void;
  private picks: DiffPicks = DEFAULT_DIFF_PICKS;
  /** The first root's summary, which the toolbar and the note under the list speak of. */
  private summary: DiffSummary | null = null;
  /** The roots of the latest read, in their order; none before it, and after one git refused in a folder with no repository inside it either. */
  private roots: ExplorerRoot[] = [];
  /** Each root's latest read, by its path. */
  private reads = new Map<string, ChangesRead>();
  /** Why git refused the folder the panel looks in, as git said it, where nothing inside it is a repository either; null otherwise. */
  private failure: string | null = null;
  /** Whether the panel passed its last check; null until the first has answered. */
  private runnable: boolean | null = null;
  /** How to stop following each root it follows, by its path. */
  private readonly following = new Map<string, () => void>();
  /** The question it follows its roots for; null while it follows none. */
  private followedQuestion: DiffQuestion | null = null;
  /** The checkout the latest read looked in, or the folder, where that is no checkout. */
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
      () => this.jumps(),
      {
        all: () => this.files.allFolded(),
        any: () => this.files.hasRoots(),
        toggle: () => this.files.foldAll(!this.files.allFolded()),
      },
    );
    this.files.onDraw = () => this.toolbar.drawFolds();
    this.el.append(this.toolbar.el, this.files.el, this.note);
    this.gate = new RunGate(
      () => runKey(optionsOf(this.slot.entry).cwd, resolveContext(this.host.where())),
      (number) => void this.read(number),
    );
    this.driver = new GateDriver(this.gate, { check: () => this.check(), runnable: () => this.runnable });
    this.stopWatchingSessions = host.watchSessions(() => this.sessionsMoved());
    this.stopWatchingEditor = store.watch(['editorTabs', 'tabs', 'activeTab'], () => this.editorMoved());
    host.setViews(VIEWS);
    this.say('Counting the changed files…');
    void this.loadPicks();
    // Checked at once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.check();
  }

  unmount(): void {
    this.disposed = true;
    this.gate.stop();
    this.unfollow();
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

  /** Open the file pressed in the Editor, with the list's order, across its roots, to step through. */
  private pickFile(pressed: Placed, keep: boolean): void {
    const steps = this.files.order().flatMap((placed) => this.stepOf(placed) ?? []);
    const step = this.stepOf(pressed);
    if (!step) return;
    openInEditor({ root: step.root, file: step.file, diff: { question: this.picks.question, against: step.against }, files: steps }, keep);
  }

  /** A file of the list as the Editor steps through it, or null where its root has no comparison to make. */
  private stepOf(placed: Placed): StepFile | null {
    const read = this.reads.get(placed.root);
    if (read?.kind !== 'summary' || !read.summary.against) return null;
    const file = read.summary.files.find((each) => each.path === placed.path);
    return file ? { root: placed.root, against: read.summary.against, file } : null;
  }

  /** The file the Editor shows for the tab on show, by its root and path. */
  private picked(): Placed | null {
    const set = editorTabsOnShow();
    const shown = set.tabs.find((tab) => tab.key === set.active);
    return shown ? { root: shown.ref.root, path: shown.ref.file.path } : null;
  }

  /** The Editor's tabs changed: mark the row it shows. */
  private editorMoved(): void {
    if (this.roots.length) this.drawRows();
  }

  /** Where the toolbar's jump goes: each root, with how many files changed there, the main checkout the session changed nothing in muted, as a project heading's ungrouped sessions are. */
  private jumps(): MenuItem[] {
    return this.roots.map((root) => ({
      label: root.name,
      count: filesOf(this.reads.get(root.path)).length,
      muted: root.reason === 'shared',
      onSelect: () => this.files.reveal(root.path),
    }));
  }

  /** The session whose checkouts are roots: the one on show, unless the panel has a folder of its own. */
  private rootsSession(): SessionSummary | null {
    if (optionsOf(this.slot.entry).cwd) return null;
    const id = this.host.where().tab?.id;
    return id ? sessionById(id) : null;
  }

  /** Check the options against the selection as it is now, and tell the host what is wrong and where the panel looks; null once the panel is gone. */
  private async check(): Promise<{ problems: string[]; dir: string | null } | null> {
    const { problems, run, folder } = await prepare(optionsOf(this.slot.entry), EXPLORER_OPTIONS, this.host.where());
    if (this.disposed) return null;
    this.runnable = problems.length === 0;
    this.host.setProblems(problems);
    this.host.setFolder(folder ?? null);
    return { problems, dir: run?.cwd ?? null };
  }

  /** Read the list for read `number`, checking first: the checkout the panel looks in and the repositories inside its folder, then the session's other roots; only the latest read draws, and it then follows each root it read. */
  private async read(number: number): Promise<void> {
    // Another question's answers stop drawing at once, rather than once its own come back.
    if (this.followedQuestion !== null && this.followedQuestion !== this.picks.question) this.unfollow();
    const checked = await this.check();
    if (!checked || !this.gate.isLatest(number)) return;
    if (checked.problems.length || checked.dir === null) {
      this.unfollow();
      if (checked.dir === null && !checked.problems.length) this.idle();
      if (!checked.problems.length) this.gate.ended(number);
      return;
    }
    this.host.setBusy(true);
    const question = this.picks.question;
    const [first, inside] = await Promise.all([checkoutReads.read(checked.dir, question), window.claudeUi.nestedRepositories(checked.dir)]);
    const insideReads = await Promise.all(inside.map((path) => checkoutReads.read(path, question)));
    const reads = new Map(inside.map((path, at) => [path, insideReads[at]!]));
    const nested = inside.map((path): NestedRepository => ({ path, changed: filesOf(reads.get(path)).length > 0 }));
    // A read git refused names no checkout: the repositories inside the folder are then its only roots; the whole checkout otherwise, whatever subfolder the panel looks in.
    const firstRoot = first.kind === 'summary' ? first.summary.root : null;
    if (firstRoot) reads.set(firstRoot, first);
    const roots = explorerRoots(firstRoot, checked.dir, this.rootsSession(), nested);
    const rest = roots.filter((root) => !reads.has(root.path));
    const restReads = await Promise.all(rest.map((root) => checkoutReads.read(root.path, question)));
    if (this.disposed || !this.gate.isLatest(number)) return;
    this.host.setBusy(false);
    rest.forEach((root, at) => reads.set(root.path, restReads[at]!));
    this.roots = roots;
    this.reads = reads;
    this.dir = firstRoot ?? checked.dir;
    // The toolbar and the note speak of the checkout the panel looks in, and of none where its folder is no checkout.
    this.summary = first.kind === 'summary' ? first.summary : null;
    this.follow(question);
    // Git's refusal is the panel's to say only where nothing inside the folder is a repository either.
    this.draw(first.kind === 'failed' && !roots.length ? first.error : null);
    this.gate.ended(number);
  }

  /** Follow every root's changes for `question`, letting go of roots no longer among them, or of all when the question is another. */
  private follow(question: DiffQuestion): void {
    if (this.followedQuestion !== question) this.unfollow();
    this.followedQuestion = question;
    const paths = new Set(this.roots.map((root) => root.path));
    for (const [path, stop] of this.following) {
      if (paths.has(path)) continue;
      stop();
      this.following.delete(path);
    }
    for (const path of paths) {
      if (this.following.has(path)) continue;
      this.following.set(path, checkoutReads.follow(path, question, (read) => this.heard(path, read)));
    }
  }

  /** A root's changes were read again by someone: draw them, unless they are what is drawn. */
  private heard(path: string, read: ChangesRead): void {
    if (this.disposed || this.reads.get(path) === read) return;
    this.reads.set(path, read);
    if (path !== this.roots[0]?.path || this.roots[0].reason !== 'works') {
      this.draw(this.failure);
      return;
    }
    this.summary = read.kind === 'summary' ? read.summary : null;
    this.draw(read.kind === 'failed' ? read.error : null);
  }

  private unfollow(): void {
    for (const stop of this.following.values()) stop();
    this.following.clear();
    this.followedQuestion = null;
  }

  /** A panel that can run with nowhere to run: it says so, as a command panel does. */
  private idle(): void {
    this.unfollow();
    this.roots = [];
    this.reads.clear();
    this.summary = null;
    this.dir = null;
    this.toolbar.draw();
    this.files.draw([], this.view(), null);
    this.host.setCount(null);
    this.say(NO_CONTEXT);
  }

  private draw(failure: string | null): void {
    this.failure = failure;
    this.toolbar.draw();
    this.host.setStatus(failure ? 'fail' : null);
    this.host.setCount(this.roots.length ? this.listed() : null);
    this.drawRows();
  }

  /** How many files the roots list, those of a root that starts folded left out, since they are others' changes. */
  private listed(): number {
    return this.roots.filter((root) => !root.folded).reduce((sum, root) => sum + filesOf(this.reads.get(root.path)).length, 0);
  }

  /** The rows, the one the Editor shows marked, and what the list says under them. */
  private drawRows(): void {
    const files = this.summary?.files ?? [];
    this.files.draw(this.roots.map((root) => ({ root, read: this.reads.get(root.path) })), this.view(), this.picked());
    const failure = this.failure;
    if (failure) this.say(`Git could not read the changes here: ${failure.replace(/\.$/, '')}.`);
    else if (!this.summary) this.say('');
    else if (this.picks.question === 'since' && !this.summary.base) this.say(`No base to measure from: neither upstream nor origin has a default branch, or a develop, main or master branch, here. ${QUESTION_NAMES.unpushed} and ${QUESTION_NAMES.uncommitted} still work.`);
    else if (!files.length && this.listed() === 0) this.say(NOTHING[this.picks.question](this.summary));
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

/** The files a read lists; none for one git refused, or none yet. */
function filesOf(read: ChangesRead | undefined): readonly DiffFile[] {
  return read?.kind === 'summary' ? read.summary.files : [];
}
