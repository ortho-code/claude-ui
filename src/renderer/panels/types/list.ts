import { PANEL_OUTPUT_CAP, PANEL_TIMEOUT_MS, typeFolder, type PanelContext, type PanelRunEvent } from '../../../shared/panels';
import { stripAnsi } from '../../ui/ansi';
import { element } from '../../ui/dom';
import { language, onLanguageChange } from '../../ui/locale';
import { setTooltip } from '../../ui/tooltip';
import type { PanelSlot } from '../layout';
import { intervalOf, optionsOf } from '../options';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import { NO_CONTEXT, endLabel, prepare, runFailed } from '../run';
import { PanelRuns, RunPanel, type Checked, type RunAsk, type RunEnd, type RunProgress } from '../runs';
import type { FolderType } from './folder';
import { readListDocument, type ListDocument } from './list-doc';
import { ListView } from './list-view';
import '../../ui/tone.css';
import './list.css';

/**
 * The `list` kind: a type from the config folder whose script prints a list document (list-doc.ts), which the app draws with its own styles (list-view.ts).
 *
 * WHEN IT RUNS (`RunGate`, through `PanelRuns`, which a command panel's runs go through too): on first being shown, on Refresh, on a context change once it has run, shown or not, and on its interval if it has one — the interval also while the panel is hidden or folded, so the count on its rail stays true.
 * NEVER AN EMPTY LIST FOR A BROKEN RUN: a run that fails, or prints something that is not a list, says so.
 * With a good list already on screen, the list stays under a line saying the run failed, when, and why, so a bad minute on the network does not blank a queue; without one, the panel says it is unavailable and why.
 * Before the first run has ended it says it is waiting, which is neither.
 */

/** How much of a run's stderr is kept: its end, which is where a script says what went wrong. */
const STDERR_KEPT = 8 * 1024;
/** How many of stderr's last lines a failure quotes. */
const STDERR_LINES = 4;

const WAITING = 'Waiting for the first run…';

/** What went wrong with a run that ended badly, as the clause both the unavailable state and the failed-run line build on. */
function failureClause(event: PanelRunEvent): string {
  if (event.kind === 'exit') {
    if (event.error) return `the script could not run: ${event.error}`;
    if (event.code === null) return `the script was killed by ${event.signal ?? 'a signal'}`;
    return `the script exited with ${event.code}`;
  }
  if (event.kind === 'stopped' && event.reason === 'timeout') return `the script was still running after ${PANEL_TIMEOUT_MS / 1000} s, so it was stopped`;
  return `the script printed more than ${PANEL_OUTPUT_CAP / 1024 / 1024} MB, so it was stopped`;
}

/** The last few lines a run wrote on stderr, which is where a script says why it failed. */
function stderrTail(stderr: string): string[] {
  return stripAnsi(stderr)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .slice(-STDERR_LINES);
}

const clock = (at: Date): string => at.toLocaleTimeString(language(), { hour: '2-digit', minute: '2-digit' });

/** What a list panel runs with: where, and the script where the check found it, so the run starts exactly what was checked. */
interface ListReady {
  context: PanelContext;
  script: string;
}

class ListPanel extends RunPanel<ListReady> {
  readonly el = element('div', 'panel-body');
  private readonly placeholder = element('div', 'pane-placeholder');
  private readonly failedLine = element('div', 'panel-note list-failed');
  private readonly view: ListView;
  private readonly unavailable = element('div', 'panel-problems');
  protected readonly runs: PanelRuns<ListReady>;
  private stdout = '';
  private stderr = '';
  /** The last list a run printed, and when; null until one has. */
  private good: { doc: ListDocument; at: Date } | null = null;
  /** Why the last run did not give a list, and when; null when it did. */
  private failure: { clause: string; lines: string[]; at: Date } | null = null;
  /** Runnable, with nowhere to run: a relative `cwd` and no project picked. */
  private noContext = false;
  /** Where the last run ran, which a session a row asks for is offered the project of. */
  private lastDir: string | null = null;
  /** Stops drawing the failed run's line again when the language changes, which says its times in it. */
  private readonly stopLanguage: () => void;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
    private readonly type: PanelType,
    private readonly folder: FolderType,
  ) {
    super();
    this.view = new ListView(host, { from: () => this.slot.title, dir: () => this.lastDir });
    this.placeholder.textContent = WAITING;
    this.el.append(this.placeholder, this.failedLine, this.view.el, this.unavailable);
    this.show();
    this.stopLanguage = onLanguageChange(() => this.show());
    this.runs = new PanelRuns(slot, host, () => this.interval(), this);
    // Through the runs, which put what a run's control file got wrong beside them.
    this.runs.setNotes(folder.notes);
  }

  sessionsChanged(): void {
    this.view.draw();
  }

  override unmount(): void {
    this.stopLanguage();
    super.unmount();
  }

  /** The interval the panel runs on, in ms: the entry's own, else its type's; null for none. */
  private interval(): number | null {
    return intervalOf(optionsOf(this.slot.entry), this.folder.manifest?.interval ?? null);
  }

  /** The options the type declares, as the entry gives them: what the script gets as `CLAUDE_UI_OPTION_<NAME>`, a text as written and a list as its JSON, since a variable holds a string. */
  private optionValues(): Record<string, string> {
    const options = optionsOf(this.slot.entry);
    const values: Record<string, string> = {};
    for (const { name, kind } of this.folder.manifest?.options ?? []) {
      const value = options[name];
      if (kind === 'list' && Array.isArray(value)) values[name] = JSON.stringify(value);
      else if (typeof value === 'string') values[name] = value;
    }
    return values;
  }

  /**
   * What is wrong with the type or the entry, and where the panel would run when nothing is.
   * The manifest first, since nothing else can be checked against one that is not sound; then the entry's options and the script together, so one look says all there is to fix.
   */
  async check(): Promise<Checked<ListReady>> {
    const { manifest } = this.folder;
    if (!manifest) return { problems: this.folder.problems, ready: null };
    const [prepared, script] = await Promise.all([
      prepare(optionsOf(this.slot.entry), this.type, this.host.where()),
      window.claudeUi.checkPath(manifest.run, { dir: this.folder.dir }, 'executable'),
    ]);
    const problems = [...prepared.problems, ...(script.problem ? [`${typeFolder(this.folder.name)}: run ${script.problem}.`] : [])];
    this.host.setFolder(problems.length === 0 ? (prepared.folder ?? null) : null);
    return { problems, ready: problems.length === 0 && prepared.run ? { context: prepared.run, script: script.path } : null, retry: prepared.retry, watched: prepared.watched };
  }

  /**
   * The view to give the script: the one picked when the last list offered it, else that list's first, as its switch marks them.
   * Before any list has said what it offers, the pick as it stands, and empty without one; empty too for a list offering none.
   */
  private viewToRun(): string {
    const picked = this.host.view();
    const offered = this.good?.doc.views;
    if (offered === undefined) return picked ?? '';
    return offered.find(({ id }) => id === picked)?.id ?? offered[0]?.id ?? '';
  }

  idle(runnable: boolean): void {
    // A panel that cannot run is drawn by the tree as its problems; this is for one that can, with nowhere to run.
    this.noContext = runnable;
    this.show();
  }

  start({ context, script }: ListReady): RunAsk {
    this.noContext = false;
    this.lastDir = context.cwd;
    this.stdout = '';
    this.stderr = '';
    this.show();
    // Apart: stdout alone is the document, and stderr is kept for the reason a failure gives.
    return { stderr: 'apart', source: { script }, context, options: this.optionValues(), view: this.viewToRun(), sessions: this.host.sessionsSnapshot() };
  }

  progress(event: RunProgress): void {
    switch (event.kind) {
      case 'output':
        this.stdout += event.text;
        return;
      case 'stderr':
        this.stderr = (this.stderr + event.text).slice(-STDERR_KEPT);
        return;
      // A stop follows it, and says the same.
      case 'truncated':
        return;
    }
  }

  ended(event: RunEnd): void {
    // A stop the app asked for itself — a re-run, a removal, the quit — says nothing about the script.
    if (event.kind === 'stopped' && !runFailed(event)) return;
    const at = new Date();
    if (runFailed(event)) {
      this.failure = { clause: failureClause(event), lines: stderrTail(this.stderr), at };
      this.host.setEnd(endLabel(event));
    } else {
      const read = readListDocument(this.stdout);
      if (read.doc) {
        this.good = { doc: read.doc, at };
        this.failure = null;
        this.host.setEnd('');
        this.host.setStatus(null);
        this.host.setCount(read.doc.badge);
        this.host.setViews(read.doc.views);
        this.runs.setNotes([...this.folder.notes, ...read.doc.notes]);
        this.view.draw(read.doc);
        this.show();
        return;
      }
      this.failure = { clause: 'the script did not print a list', lines: read.problems, at };
      this.host.setEnd('no list');
    }
    this.host.setStatus('fail');
    // A count stands only beside the list it counts.
    if (!this.good) this.host.setCount(null);
    this.show();
  }

  /** Which of the four the panel is showing: nowhere to run, the list (under a failed run's line when the last one failed), unavailable, or waiting for the first run. */
  private show(): void {
    const list = this.good !== null && !this.noContext;
    const unavailable = this.good === null && this.failure !== null && !this.noContext;
    this.placeholder.hidden = list || unavailable;
    this.placeholder.textContent = this.noContext ? NO_CONTEXT : WAITING;
    this.view.el.hidden = !list;
    this.failedLine.hidden = !list || this.failure === null;
    this.unavailable.hidden = !unavailable;
    if (list && this.failure) {
      const { clause, lines, at } = this.failure;
      this.failedLine.textContent = `The run at ${clock(at)} failed: ${clause}. This is the list from ${clock(this.good!.at)}.`;
      setTooltip(this.failedLine, lines.join('\n'));
    }
    if (unavailable) {
      const { clause, lines } = this.failure!;
      this.unavailable.replaceChildren(
        ...[`Unavailable: ${clause}.`, ...lines].map((line) => {
          const p = element('p');
          p.textContent = line;
          return p;
        }),
      );
    }
  }
}

/** Mount a panel of a `list` type, or of a type whose manifest is not sound, which says why in its place. */
export function mountList(slot: PanelSlot, host: PanelHost, type: PanelType, folder: FolderType): MountedPanel {
  return new ListPanel(slot, host, type, folder);
}
