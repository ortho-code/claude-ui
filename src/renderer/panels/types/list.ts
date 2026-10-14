import { PANEL_OUTPUT_CAP, PANEL_TIMEOUT_MS, type PanelContext, type PanelRunEvent } from '../../../shared/panels';
import { stripAnsi } from '../../ansi';
// Its rows are the session list's cards and its headings the group's bar.
import { listCard, sectionHeading, setFolded } from '../../card';
import { statusLabel } from '../../logic';
import { element } from '../../dom';
import { Keyed, placeChildren } from '../../keyed';
import { sessionDotClass } from '../../statusdot';
import { setTooltip } from '../../tooltip';
import type { PanelSlot } from '../layout';
import { intervalOf, optionsOf } from '../options';
import type { MountedPanel, PanelHost, PanelType } from '../contract';
import { NO_CONTEXT, endLabel, prepare, runFailed } from '../run';
import { PanelRuns, type Checked, type RunAsk, type RunEnd, type RunHooks, type RunProgress } from '../runs';
import type { FolderType } from './folder';
import { readListDocument, type ListDocument, type ListItem, type ListSection, type SessionAction } from './listdoc';
import './list.css';

/**
 * The `list` kind: a type from the config folder whose script prints a list document (listdoc.ts), which the app draws with its own styles.
 *
 * THE SCRIPT DESCRIBES, THE APP ACTS: the script only prints, and what a row does when pressed is the app's, so a type shared from anyone can do nothing a person did not press.
 * A row opens its link in the browser, through the same route every link in the app leaves by, and its `session` action is a button that asks the app for a session, which opens the app's dialog first.
 * WHEN IT RUNS (`RunGate`, through `PanelRuns`, which a command panel's runs go through too): on first being shown, on Refresh, on a context change while shown, and on its interval if it has one — the interval also while the panel is hidden or folded, so the count on its rail stays true.
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

const clock = (at: Date): string => at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** How many rows a section lists, for its count: the rows that hold none, since a row holding rows only groups them. */
const listed = (items: ListItem[]): number => items.reduce((count, item) => count + (item.children.length > 0 ? listed(item.children) : 1), 0);

/** What a list panel runs with: where, and the script where the check found it, so the run starts exactly what was checked. */
interface ListReady {
  context: PanelContext;
  script: string;
}

class ListPanel implements MountedPanel, RunHooks<ListReady> {
  readonly el = element('div', 'panel-body');
  private readonly placeholder = element('div', 'pane-placeholder');
  private readonly failedLine = element('div', 'panel-note list-failed');
  private readonly body = element('div', 'list-body');
  private readonly unavailable = element('div', 'panel-problems');
  private readonly runs: PanelRuns<ListReady>;
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
  /** Rows holding rows, folded or unfolded by hand, by key, over what the document says, as a section's are by title. */
  private readonly rowFolds = new Map<string, boolean>();
  /** The sections on show and their rows by item key, kept from one draw to the next (`drawList`); a row's mark for the sessions it started is repainted in place when a session changes. */
  private readonly sections = new Keyed<SectionBox>((kept) => kept.box);
  private readonly rows = new Keyed<ListRow>((kept) => kept.row);
  /** Each row's item as the last draw left it, which what a press does reads. */
  private readonly items = new Map<string, ListItem>();

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
    private readonly type: PanelType,
    private readonly folder: FolderType,
  ) {
    this.placeholder.textContent = WAITING;
    this.el.append(this.placeholder, this.failedLine, this.body, this.unavailable);
    this.show();
    this.runs = new PanelRuns(slot, host, () => this.interval(), this);
    // Through the runs, which put what a run's control file got wrong beside them.
    this.runs.setNotes(folder.notes);
  }

  refresh(): void {
    this.runs.refresh();
  }

  contextChanged(): void {
    this.runs.contextChanged();
  }

  setVisible(visible: boolean): void {
    this.runs.setVisible(visible);
  }

  sessionsChanged(): void {
    for (const [key, parts] of this.rows.entries()) this.paintSessions(key, parts);
  }

  recheck(): void {
    this.runs.recheck();
  }

  unmount(): void {
    this.runs.unmount();
  }

  /** The interval the panel runs on, in ms: the entry's own, else its type's; null for none. */
  private interval(): number | null {
    return intervalOf(optionsOf(this.slot.entry), this.folder.manifest?.interval ?? null);
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
    const problems = [...prepared.problems, ...(script.problem ? [`types/${this.folder.name}: run ${script.problem}.`] : [])];
    return { problems, ready: problems.length === 0 && prepared.run ? { context: prepared.run, script: script.path } : null, retry: prepared.retry, watched: prepared.watched };
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
    return { stderr: 'apart', source: { script }, context, options: this.optionValues() };
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
        this.runs.setNotes([...this.folder.notes, ...read.doc.notes]);
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

  /**
   * Draw the list as the last good run printed it, keeping every section and row it already shows where it is: every run that prints a list and every fold draw it again (a session's status only repaints a row's mark, `sessionsChanged`), and a press on a row, or the focus on its buttons, survives that only while the row stays put (keyed.ts).
   * Sections are kept by title, or by place for one without a title or with a title used before; rows by their key, unique across the document.
   */
  private drawList(): void {
    if (!this.good) return;
    this.body.classList.toggle('compact', this.good.doc.compact);
    this.items.clear();
    const seen = new Set<string>();
    const boxes = this.good.doc.sections.map((section, at) => {
      const titled = section.title === null ? null : `title:${section.title}`;
      const key = titled !== null && !seen.has(titled) ? titled : `at:${at}`;
      seen.add(key);
      return this.drawSection(key, section);
    });
    placeChildren(this.body, boxes);
    this.sections.sweep();
    this.rows.sweep();
  }

  /**
   * A row's mark for the sessions it started: hidden without one; the latest's status dot, the same dot the session list draws, and a press goes to it; with several, their count beside the dot, and a press offers them all.
   * Only sessions the app still has: a link whose session is gone shows nothing.
   */
  private paintSessions(key: string, { mark, dot, count }: ListRow): void {
    const sessions = this.host.linkedSessions(key);
    const latest = sessions[0];
    mark.hidden = latest === undefined;
    if (!latest) return;
    dot.className = sessionDotClass(latest.status, latest.acked);
    count.textContent = String(sessions.length);
    placeChildren(mark, sessions.length > 1 ? [dot, count] : [dot]);
    // Its state in the session list's own words, so the dot says the same here as there.
    const state = statusLabel(latest.status ?? undefined, latest.acked, latest.background) ?? (latest.running ? 'running' : 'not running');
    const label = sessions.length > 1 ? `${sessions.length} sessions from this row: pick one` : `Go to ${latest.title} · ${state}`;
    mark.setAttribute('aria-label', label);
    setTooltip(mark, label);
  }

  /** A section: its heading when it has a title, which folds it, then its rows, or what it says when it has none. */
  private drawSection(key: string, section: ListSection): HTMLElement {
    const box = this.sections.draw(key, () => this.buildSection());
    box.section = section;
    const { title } = section;
    const open = title === null || (this.folds.get(title) ?? !section.shut);
    const children: HTMLElement[] = [];
    if (title !== null) {
      setFolded(box.caret, !open);
      box.label.textContent = title;
      box.count.textContent = String(listed(section.items));
      children.push(box.heading);
    }
    if (open) {
      if (section.items.length === 0 && section.empty !== null) {
        box.empty.textContent = section.empty;
        children.push(box.empty);
      }
      children.push(...this.drawItems(section.items, 0));
    }
    placeChildren(box.box, children);
    return box.box;
  }

  /** Rows, each followed by the rows it holds while it is open, one level further in; all of them siblings in the section, so a row is drawn and kept by its key wherever it sits. */
  private drawItems(items: ListItem[], depth: number): HTMLElement[] {
    return items.flatMap((item) => [this.drawItem(item, depth), ...(this.isOpen(item) ? this.drawItems(item.children, depth + 1) : [])]);
  }

  /** Whether a row shows the rows it holds: as folded by hand, else as the document says; a row holding none has nothing to fold. */
  private isOpen(item: ListItem): boolean {
    return item.children.length > 0 && (this.rowFolds.get(item.key) ?? !item.shut);
  }

  /** Fold a row holding rows, or unfold it, as it is now. */
  private toggleRow(key: string): void {
    const item = this.items.get(key);
    if (!item || item.children.length === 0) return;
    this.rowFolds.set(key, !this.isOpen(item));
    this.drawList();
  }

  /** A section's box and heading, built once; the heading folds the section it heads when pressed, as that section is then. */
  private buildSection(): SectionBox {
    // The sidebar's collapsible heading, so a heading that folds looks and turns the same everywhere.
    const { heading, caret, label, count } = sectionHeading('bar');
    const parts: SectionBox = { box: element('section', 'list-section'), heading, caret, label, count, empty: element('div', 'section-empty'), section: null };
    heading.addEventListener('click', () => {
      const title = parts.section?.title;
      if (title === undefined || title === null) return;
      this.folds.set(title, !(this.folds.get(title) ?? !parts.section!.shut));
      this.drawList();
    });
    return parts;
  }

  /**
   * A row, as text only: the script may come from anyone, so nothing it prints is ever markup.
   * `depth` is how many rows hold it, which sets it that many steps in.
   */
  private drawItem(item: ListItem, depth: number): HTMLElement {
    this.items.set(item.key, item);
    const parts = this.rows.draw(item.key, (key) => this.buildRow(key));
    const { row, content, line, fold, lead, title, text, trail, meta, mark } = parts;
    const holds = item.children.length > 0;
    // Pressable when it has a link to open or rows to fold.
    row.className = `card list-row tone-${item.tone}${item.href === null && !holds ? ' still' : ''}`;
    row.style.setProperty('--depth', String(depth));
    if (holds) {
      const open = this.isOpen(item);
      setFolded(fold, !open);
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-label', open ? `Fold ${item.text}` : `Unfold ${item.text}`);
    }
    lead.className = `list-lead tone-${item.leadTone}`;
    lead.textContent = item.lead ?? '';
    text.textContent = item.text;
    title.classList.toggle('cut-start', item.cut === 'start');
    trail.textContent = item.trail ?? '';
    placeChildren(line, [...(holds ? [fold] : []), ...(item.lead !== null ? [lead] : []), title, ...(item.trail !== null ? [trail] : [])]);
    // On the first line alone, so the rest of a row with a link still says where the link goes.
    setTooltip(line, item.tooltip);
    meta.textContent = item.detail ?? '';
    placeChildren(content, item.detail !== null ? [line, meta] : [line]);
    this.paintSessions(item.key, parts);
    // What a row offers, as buttons at its end, each kept by all it says — its label, prompt and name — so a run that changes an action gives it a new button, and a press on the old one comes to nothing rather than asking for the new one.
    // Each only ASKS: the app's dialog shows what would start, and nothing does until Start there.
    const said = new Map<string, number>();
    const buttons = item.actions.map((action) => {
      const what = JSON.stringify([action.label, action.prompt, action.name]);
      const again = said.get(what) ?? 0;
      said.set(what, again + 1);
      return parts.actions.draw(`${what}#${again}`, () => this.buildAction(item.key, action));
    });
    parts.actions.sweep();
    // Where a click goes, since a shared type's rows are somebody else's links.
    setTooltip(row, item.href);
    // The sessions it started, before what it offers, so going back comes before starting again.
    placeChildren(row, [content, mark, ...buttons]);
    return row;
  }

  /** A row, built once: what a press does it reads from the row's item as the last draw left it (`items`), since the next run may change it under the same key. */
  private buildRow(key: string): ListRow {
    const { card: row, content, title, meta } = listCard('list-row');
    // The first line: the lead, the text and the trail, which the text gives way to.
    const line = element('div', 'list-line');
    // The text in an element of its own inside the title, which a text cut at its start needs to keep its own order (list.css).
    const text = element('span', 'list-text');
    title.append(text);
    const mark = element('button', 'icon-btn list-session');
    mark.type = 'button';
    mark.addEventListener('click', (event) => {
      event.stopPropagation();
      const sessions = this.host.linkedSessions(key);
      if (sessions.length === 1) this.host.openSession(sessions[0]!.id);
      else if (sessions.length > 1) this.host.pickSession(mark, sessions);
    });
    const dot = element('span');
    const count = element('span', 'list-session-count');
    // The chevron of a row holding rows: the section heading's own caret, in a button of its own so it folds from the keyboard too.
    const fold = element('button', 'icon-btn compact list-fold');
    fold.type = 'button';
    fold.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleRow(key);
    });
    // A row's link wins a press on it; a row without one that holds rows folds them.
    row.addEventListener('click', () => {
      const href = this.items.get(key)?.href;
      if (href) window.claudeUi.openExternal(href);
      else this.toggleRow(key);
    });
    return { row, content, line, fold, lead: element('span'), title, text, trail: element('span', 'list-trail'), meta, mark, dot, count, actions: new Keyed<HTMLButtonElement>((button) => button) };
  }

  /** The button for one of a row's actions, which asks for the session it describes, under the row as the last draw left it. */
  private buildAction(key: string, action: SessionAction): HTMLButtonElement {
    const button = element('button', 'list-action');
    button.type = 'button';
    button.textContent = action.label;
    setTooltip(button, action.prompt);
    button.addEventListener('click', (event) => {
      // Its own click, not the row's link.
      event.stopPropagation();
      const item = this.items.get(key);
      if (!item) return;
      this.host.startSession({ from: this.slot.title, key, label: item.text, href: item.href, name: action.name, prompt: action.prompt, dir: this.lastDir });
    });
    return button;
  }
}

/** A list row and the parts each draw writes. */
interface ListRow {
  row: HTMLElement;
  content: HTMLElement;
  /** The first line, holding the chevron, the lead, the title and the trail. */
  line: HTMLElement;
  /** The chevron of a row holding rows, which folds them. */
  fold: HTMLButtonElement;
  lead: HTMLElement;
  title: HTMLElement;
  /** The text itself, inside the title. */
  text: HTMLElement;
  trail: HTMLElement;
  meta: HTMLElement;
  /** The mark for the sessions the row started, with its dot and, for several, their count. */
  mark: HTMLButtonElement;
  dot: HTMLElement;
  count: HTMLElement;
  /** Its action buttons, each kept by all its action says. */
  actions: Keyed<HTMLButtonElement>;
}

/** A section's box and heading, and the section it shows now, which a press on the heading folds. */
interface SectionBox {
  box: HTMLElement;
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
  empty: HTMLElement;
  section: ListSection | null;
}

/** Mount a panel of a `list` type, or of a type whose manifest is not sound, which says why in its place. */
export function mountList(slot: PanelSlot, host: PanelHost, type: PanelType, folder: FolderType): MountedPanel {
  return new ListPanel(slot, host, type, folder);
}
