import { PANEL_OUTPUT_CAP, PANEL_TIMEOUT_MS, type PanelContext, type PanelRunEvent } from '../../../shared/panels';
import { stripAnsi } from '../../ansi';
// Its rows are the session list's cards and its headings the group's bar.
import { listCard, sectionHeading, setFolded } from '../../card';
import { statusLabel } from '../../logic';
import { element } from '../../dom';
import { setTooltip } from '../../tooltip';
import type { PanelSlot } from '../layout';
import { optionsOf, parseDuration } from '../options';
import { listenForRuns } from '../runs';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import { NO_CONTEXT, RunGate, endLabel, prepare, resolveContext, runFailed, runKey } from '../run';
import type { FolderType } from './folder';
import { readListDocument, type ListDocument, type ListItem, type ListSection } from './listdoc';
import './list.css';

/**
 * The `list` kind: a type from the config folder whose script prints a list document (listdoc.ts), which the app draws with its own styles.
 *
 * THE SCRIPT DESCRIBES, THE APP ACTS: the script only prints, and what a row does when pressed is the app's, so a type shared from anyone can do nothing a person did not press. A row opens its link in the browser, through the same route every link in the app leaves by, and its `session` action is a button that asks the app for a session, which opens the app's dialog first.
 * WHEN IT RUNS: on first being shown, on Refresh, on a context change while shown (the command panel's `RunGate`), and on its interval if it has one — the interval also while the panel is hidden or folded, so the count on its rail stays true.
 * NEVER AN EMPTY LIST FOR A BROKEN RUN: a run that fails, or prints something that is not a list, says so. With a good list already on screen, the list stays under a line saying the run failed, when, and why, so a bad minute on the network does not blank a queue; without one, the panel says it is unavailable and why. Before the first run has ended it says it is waiting, which is neither.
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

const clock = (at: Date): string => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

class ListPanel implements MountedPanel {
  readonly el = element('div', 'panel-body');
  private readonly placeholder = element('div', 'pane-placeholder');
  private readonly failedLine = element('div', 'panel-note list-failed');
  private readonly body = element('div', 'list-body');
  private readonly unavailable = element('div', 'panel-problems');
  private readonly gate: RunGate;
  private readonly stopListening: () => void;
  /** The current run's token, or null while nothing is running; an event under any other is a superseded run's tail. */
  private token: string | null = null;
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
  /** Sections folded or unfolded by hand, by title, over what the document says. */
  private readonly folds = new Map<string, boolean>();
  /** Each row's mark for the sessions it started, by item key: repainted in place when a session changes, so a status event never rebuilds the list under the pointer. */
  private readonly sessionMarks = new Map<string, HTMLButtonElement>();
  /** Whether the type, the options and the script passed their last check; null until the first has answered. */
  private runnable: boolean | null = null;
  /** Counts the runs asked for, so one whose check is overtaken by a newer ask drops out rather than starting after it. */
  private asked = 0;
  /** The tree has shown or hidden the panel at least once, which is when panels may run. */
  private live = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
    private readonly type: PanelType,
    private readonly folder: FolderType,
  ) {
    this.placeholder.textContent = WAITING;
    this.el.append(this.placeholder, this.failedLine, this.body, this.unavailable);
    this.show();
    host.setNotes(folder.notes);
    this.stopListening = listenForRuns(slot.key, (token, event) => this.handle(token, event));
    // Keyed by where the run would go, as a command panel's is, so a fixed `cwd` never re-runs on a switch.
    this.gate = new RunGate(
      () => runKey(optionsOf(this.slot.entry).cwd, resolveContext(this.host.where())),
      () => void this.run(),
    );
    // At once rather than on first show, so a panel behind another already wears `alert` on its rail.
    void this.check();
  }

  refresh(): void {
    this.gate.refresh();
  }

  contextChanged(): void {
    this.gate.contextChanged();
  }

  setVisible(visible: boolean): void {
    // The first call is the tree going live: a panel with an interval runs from here, shown or not, so its count is true from the start.
    if (!this.live) {
      this.live = true;
      if (!visible && this.interval() !== null) this.gate.refresh();
    }
    const asked = this.asked;
    this.gate.setVisible(visible);
    // Coming back into view while it could not run is a look at it, so it looks again — unless showing it just asked for a run, which checks first anyway.
    if (visible && this.runnable === false && this.asked === asked) this.recheck();
  }

  sessionsChanged(): void {
    for (const [key, mark] of this.sessionMarks) this.paintSessions(key, mark);
  }

  recheck(): void {
    const was = this.runnable;
    void this.check().then((checked) => {
      if (!checked || was !== false) return;
      // A panel that could not run and now can runs again: one with an interval straight away, as it would have, and any other when it is next on show.
      if (this.live && this.interval() !== null) this.gate.refresh();
      else this.gate.rerun();
    });
  }

  unmount(): void {
    this.disposed = true;
    this.unschedule();
    if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
    this.token = null;
    this.stopListening();
  }

  /** The interval the panel runs on, in ms: the entry's own, else its type's; null for none. */
  private interval(): number | null {
    const own = optionsOf(this.slot.entry).interval;
    const value = typeof own === 'string' ? own : (this.folder.manifest?.interval ?? null);
    return value === null ? null : parseDuration(value);
  }

  /** The options the type declares, as the entry gives them: what the script gets as `CLAUDE_UI_OPTION_<NAME>`. */
  private optionValues(): Record<string, string> {
    const options = optionsOf(this.slot.entry);
    const values: Record<string, string> = {};
    for (const { name } of this.folder.manifest?.options ?? []) {
      const value = options[name];
      if (typeof value === 'string') values[name] = value;
    }
    return values;
  }

  /**
   * What is wrong with the type or the entry, told to the host, and where the panel would run when nothing is.
   * The manifest first, since nothing else can be checked against one that is not sound; then the entry's options and the script together, so one look says all there is to fix.
   */
  private async check(): Promise<{ run: PanelContext | null; script: string } | null> {
    const { manifest } = this.folder;
    if (!manifest) {
      this.runnable = false;
      this.host.setProblems(this.folder.problems);
      return null;
    }
    const [prepared, script] = await Promise.all([
      prepare(optionsOf(this.slot.entry), this.type, this.host.where()),
      window.claudeUi.checkPath(manifest.run, { dir: this.folder.dir }, 'executable'),
    ]);
    if (this.disposed) return null;
    const problems = [...prepared.problems, ...(script.problem ? [`types/${this.folder.name}: run ${script.problem}.`] : [])];
    this.runnable = problems.length === 0;
    this.host.setProblems(problems);
    // The script where the check found it, so the run starts exactly what was checked.
    return this.runnable ? { run: prepared.run, script: script.path } : null;
  }

  /** Every run checks first: a script can lose its executable bit, or a folder go, between two runs. */
  private async run(): Promise<void> {
    const asked = ++this.asked;
    const checked = await this.check();
    if (asked !== this.asked || this.disposed) return;
    if (!checked?.run) {
      if (this.token !== null) window.claudeUi.stopPanel(this.slot.key);
      this.token = null;
      this.host.setBusy(false);
      // A panel that cannot run is drawn by the tree as its problems; this is for one that can, with nowhere to run.
      this.noContext = checked !== null;
      this.show();
      if (checked) this.schedule();
      return;
    }
    this.noContext = false;
    this.lastDir = checked.run.cwd;
    this.token = crypto.randomUUID();
    this.stdout = '';
    this.stderr = '';
    this.host.setBusy(true);
    this.show();
    // Apart: stdout alone is the document, and stderr is kept for the reason a failure gives.
    window.claudeUi.runPanel({ entryId: this.slot.key, stderr: 'apart', token: this.token, source: { script: checked.script }, context: checked.run, options: this.optionValues() });
  }

  private handle(token: string, event: PanelRunEvent): void {
    if (token !== this.token) return;
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
      case 'exit':
      case 'stopped':
        this.token = null;
        this.host.setBusy(false);
        this.ended(event);
        this.schedule();
        return;
    }
  }

  private ended(event: PanelRunEvent): void {
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
        this.host.setNotes([...this.folder.notes, ...read.doc.notes]);
        this.drawList();
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

  private schedule(): void {
    this.unschedule();
    const ms = this.interval();
    if (ms === null || this.disposed || this.runnable === false) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.gate.refresh();
    }, ms);
  }

  private unschedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Which of the four the panel is showing: nowhere to run, the list (under a failed run's line when the last one failed), unavailable, or waiting for the first run. */
  private show(): void {
    const list = this.good !== null && !this.noContext;
    const unavailable = this.good === null && this.failure !== null && !this.noContext;
    this.placeholder.hidden = list || unavailable;
    this.placeholder.textContent = this.noContext ? NO_CONTEXT : WAITING;
    this.body.hidden = !list;
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

  private drawList(): void {
    if (!this.good) return;
    this.sessionMarks.clear();
    this.body.replaceChildren(...this.good.doc.sections.map((section) => this.drawSection(section)));
  }

  /**
   * A row's mark for the sessions it started: hidden without one; the latest's status dot, the same dot the session list draws, and a press goes to it; with several, their count beside the dot, and a press offers them all.
   * Only sessions the app still has: a link whose session is gone shows nothing.
   */
  private paintSessions(key: string, mark: HTMLButtonElement): void {
    const sessions = this.host.linkedSessions(key);
    const latest = sessions[0];
    mark.hidden = latest === undefined;
    if (!latest) return;
    const dot = element('span', latest.status ? `nudge single ${latest.status}${latest.acked ? ' acked' : ''}` : 'nudge single');
    const parts: HTMLElement[] = [dot];
    if (sessions.length > 1) {
      const count = element('span', 'list-session-count');
      count.textContent = String(sessions.length);
      parts.push(count);
    }
    mark.replaceChildren(...parts);
    // Its state in the session list's own words, so the dot says the same here as there.
    const state = statusLabel(latest.status ?? undefined, latest.acked) ?? (latest.running ? 'running' : 'not running');
    const label = sessions.length > 1 ? `${sessions.length} sessions from this row: pick one` : `Go to ${latest.title} · ${state}`;
    mark.setAttribute('aria-label', label);
    setTooltip(mark, label);
  }

  /** A section: its heading when it has a title, which folds it, then its rows, or what it says when it has none. */
  private drawSection(section: ListSection): HTMLElement {
    const box = element('section', 'list-section');
    const { title } = section;
    const open = title === null || (this.folds.get(title) ?? !section.shut);
    if (title !== null) {
      // The sidebar's collapsible heading, so a heading that folds looks and turns the same everywhere.
      const { heading, caret, label, count } = sectionHeading('bar');
      setFolded(caret, !open);
      label.textContent = title;
      count.textContent = String(section.items.length);
      heading.addEventListener('click', () => {
        this.folds.set(title, !open);
        this.drawList();
      });
      box.append(heading);
    }
    if (!open) return box;
    if (section.items.length === 0 && section.empty !== null) {
      const empty = element('div', 'section-empty');
      empty.textContent = section.empty;
      box.append(empty);
    }
    box.append(...section.items.map((item) => this.drawItem(item)));
    return box;
  }

  /** A row, as text only: the script may come from anyone, so nothing it prints is ever markup. */
  private drawItem(item: ListItem): HTMLElement {
    const { card: row, content, title, meta } = listCard(`list-row tone-${item.tone}`);
    title.textContent = item.text;
    if (item.detail !== null) {
      meta.textContent = item.detail;
      content.append(meta);
    }
    // The sessions it started, before what it offers, so going back comes before starting again.
    const mark = element('button', 'icon-btn list-session');
    mark.type = 'button';
    mark.addEventListener('click', (event) => {
      event.stopPropagation();
      const sessions = this.host.linkedSessions(item.key);
      if (sessions.length === 1) this.host.openSession(sessions[0]!.id);
      else if (sessions.length > 1) this.host.pickSession(mark, sessions);
    });
    this.sessionMarks.set(item.key, mark);
    this.paintSessions(item.key, mark);
    row.append(mark);
    // What a row offers, as buttons at its end. Each only ASKS: the app's dialog shows what would start, and nothing does until Start there.
    for (const action of item.actions) {
      const button = element('button', 'list-action');
      button.type = 'button';
      button.textContent = action.label;
      setTooltip(button, action.prompt);
      button.addEventListener('click', (event) => {
        // Its own click, not the row's link.
        event.stopPropagation();
        this.host.startSession({ from: this.slot.title, key: item.key, label: item.text, href: item.href, name: action.name, prompt: action.prompt, dir: this.lastDir });
      });
      row.append(button);
    }
    if (item.href !== null) {
      const href = item.href;
      // Where a click goes, since a shared type's rows are somebody else's links.
      setTooltip(row, href);
      row.addEventListener('click', () => window.claudeUi.openExternal(href));
    } else row.classList.add('still');
    return row;
  }
}

/** Mount a panel of a `list` type, or of a type whose manifest is not sound, which says why in its place. */
export function mountList(slot: PanelSlot, host: PanelHost, type: PanelType, folder: FolderType): MountedPanel {
  return new ListPanel(slot, host, type, folder);
}
