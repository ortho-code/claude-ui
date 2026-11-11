// Its rows are the session list's cards and its headings the group's bar.
import { listCard, sectionHeading, setFolded } from '../../ui/card';
import { element } from '../../ui/dom';
import { routeLinks } from '../../window/external-links';
import { Keyed, placeChildren } from '../../ui/keyed';
import { kebabButton, type MenuItem } from '../../ui/menu';
import { ackOnClick, sessionDotClass } from '../../status/status-dot';
import { setTooltip } from '../../ui/tooltip';
import type { LinkedSession, PanelHost } from '../contract';
import { DEFAULT_BUTTONS, type DetailPart, type ListAction, type ListDocument, type ListItem, type ListSection, type RowText, type Verb } from './list-doc';

/** All an action says, its label and its verb: what a row's button is kept by, and what a menu item checks the row still offers when chosen. */
const actionKey = (action: ListAction): string => JSON.stringify([action.label, action.does]);

/** The link a press opens, for a session the row starts to remember the row by; null for a press of another verb, or none. */
const urlOf = (press: Verb | null): string | null => (press?.verb === 'open-url' ? press.url : null);

/** What a copy's toast says when the type gives no words of its own. */
const COPIED = 'Copied.';

/** What a live value says for a session the app does not have, when the type gives no words of its own (decided 2026-10-31). */
const UNAVAILABLE = 'Unavailable';

/** A session's state in the session list's own words, so its dot says the same here as there. */
const stateOf = (session: LinkedSession): string => session.said ?? (session.running ? 'running' : 'not running');

/** How many rows a section lists, for its count: the rows that hold none, since a row holding rows only groups them. */
const listed = (items: ListItem[]): number => items.reduce((count, item) => count + (item.children.length > 0 ? listed(item.children) : 1), 0);

/** What a list's rows ask of the panel that shows them, for a session a row asks for. */
export interface ListViewContext {
  /** The panel's title, which a session a row asks for names as where it came from. */
  from: () => string;
  /** Where the last run ran, which a session a row asks for is offered the project of. */
  dir: () => string | null;
}

/**
 * A list document as the app draws it, and what a press on what it drew does.
 * THE SCRIPT DESCRIBES, THE APP ACTS: a press on a row, a part or an action carries out the verb the script named for it (`perform`, save a part's link, which `routeLinks` opens), so a type decides what its rows do and nothing happens that a person did not press.
 * A link opens in the browser, through the same route every link in the app leaves by; a `session` asks the app for a session, which opens the app's dialog first; a row with no press of its own folds the rows it holds, from a press outside its buttons, its marks and its parts with a press.
 */
export class ListView {
  readonly el = element('div', 'list-body');
  /** The document on show; null until one is drawn. */
  private doc: ListDocument | null = null;
  /** Sections folded or unfolded by hand, by title, over what the document says. */
  private readonly folds = new Map<string, boolean>();
  /** Rows holding rows, folded or unfolded by hand, by key, over what the document says, as a section's are by title. */
  private readonly rowFolds = new Map<string, boolean>();
  /** The sections on show and their rows by item key, kept from one draw to the next (`draw`), which a change to a session runs too. */
  private readonly sections = new Keyed<SectionBox>((kept) => kept.box);
  private readonly rows = new Keyed<ListRow>((kept) => kept.row);
  /** Each row's item as the last draw left it, which what a press does reads. */
  private readonly items = new Map<string, ListItem>();
  /** What a press on each part with a verb of its own asks for, as the last draw left it, since a part is kept by its place and the next run may change its verb. */
  private readonly partPresses = new WeakMap<Element, Verb>();

  constructor(
    private readonly host: PanelHost,
    private readonly context: ListViewContext,
  ) {
    // A part linking in a row's detail goes to the browser, a click or a middle-click, and never takes the window anywhere.
    routeLinks(this.el, (url) => window.claudeUi.openExternal(url));
  }

  /**
   * Draw `doc`, or the one on show again without it, keeping every section and row already shown where it is: every run that prints a list, every fold and every change to a session draw it again (for its live values, its dots and its marks), and a press on a row, or the focus on its buttons, survives that only while the row stays put (keyed.ts).
   * Sections are kept by title, or by place for one without a title or with a title used before; rows by their key, unique across the document.
   */
  draw(doc?: ListDocument): void {
    if (doc) this.doc = doc;
    if (!this.doc) return;
    this.el.classList.toggle('compact', this.doc.compact);
    this.items.clear();
    const seen = new Set<string>();
    const boxes = this.doc.sections.map((section, at) => {
      const titled = section.title === null ? null : `title:${section.title}`;
      const key = titled !== null && !seen.has(titled) ? titled : `at:${at}`;
      seen.add(key);
      return this.drawSection(key, section);
    });
    placeChildren(this.el, boxes);
    this.sections.sweep();
    this.rows.sweep();
  }

  /** A text as the row draws it now: each live value filled in from the session it names, else in the type's words for one the app does not have, else `UNAVAILABLE`. */
  private said(text: RowText): string;
  private said(text: RowText | null): string | null;
  private said(text: RowText | null): string | null {
    if (text === null || typeof text === 'string') return text;
    return text.map((piece) => (typeof piece === 'string' ? piece : (this.host.session(piece.session)?.title ?? piece.else ?? UNAVAILABLE))).join('');
  }

  /**
   * What a row shows of a session, at its end, as one of two in the same place: the dot of the session the row names (`session`), or else the mark for the sessions the row started (decided 2026-10-31: the type chose what the place shows).
   * The named session's dot is its status dot, which a press marks read or unread where it can be marked and is otherwise the row's press, naming the session and its state on hover; nothing for a session the app does not have.
   * The mark, hidden without one: the latest's status dot, and a press goes to it; with several, their count beside the dot, and a press offers them all.
   * Only sessions the app still has: a link whose session is gone shows nothing.
   * Either dot shows the status as the session list's does, and says it in its words.
   */
  private paintSessions(item: ListItem, { mark, dot, count, namedDot, namedDotBox }: ListRow): HTMLElement | null {
    if (item.session !== null) {
      const named = this.host.session(item.session);
      if (!named) return null;
      namedDot.className = sessionDotClass(named.status, named.acked, named.canMarkRead);
      const label = `${named.title} · ${stateOf(named)}`;
      namedDotBox.setAttribute('aria-label', label);
      setTooltip(namedDotBox, label);
      return namedDotBox;
    }
    const sessions = this.host.linkedSessions(item.key);
    const latest = sessions[0];
    if (!latest) return null;
    dot.className = sessionDotClass(latest.status, latest.acked);
    count.textContent = String(sessions.length);
    placeChildren(mark, sessions.length > 1 ? [dot, count] : [dot]);
    const label = sessions.length > 1 ? `${sessions.length} sessions from this row: pick one` : `Go to ${latest.title} · ${stateOf(latest)}`;
    mark.setAttribute('aria-label', label);
    setTooltip(mark, label);
    return mark;
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
      setTooltip(box.heading, section.tooltip);
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
    this.draw();
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
      this.draw();
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
    const { row, content, line, fold, lead, title, text, trail, meta } = parts;
    const holds = item.children.length > 0;
    const said = this.said(item.text);
    // Pressable when it has a press of its own or rows to fold.
    row.className = `card list-row tone-${item.tone}${item.press === null && !holds ? ' still' : ''}`;
    row.style.setProperty('--depth', String(depth));
    if (holds) {
      const open = this.isOpen(item);
      setFolded(fold, !open);
      fold.setAttribute('aria-expanded', String(open));
      fold.setAttribute('aria-label', open ? `Fold ${said}` : `Unfold ${said}`);
    }
    lead.className = `list-lead tone-${item.leadTone}`;
    lead.textContent = this.said(item.lead) ?? '';
    text.textContent = said;
    title.classList.toggle('cut-start', item.cut === 'start');
    trail.textContent = this.said(item.trail) ?? '';
    placeChildren(line, [...(holds ? [fold] : []), ...(item.lead !== null ? [lead] : []), title, ...(item.trail !== null ? [trail] : [])]);
    // On the first line alone, which is what it most often says all of.
    setTooltip(line, this.said(item.tooltip));
    // Each line of the detail an element of its own, kept by its place, so a press on one survives a run that changes what it says.
    const detail = item.detail.map((line, at) => this.drawLine(parts.lines.draw(String(at), () => ({ el: element('span', 'list-detail-line'), pieces: new Keyed<HTMLElement>((piece) => piece) })), line, item.separator));
    parts.lines.sweep();
    placeChildren(meta, detail);
    placeChildren(content, detail.length > 0 ? [line, meta] : [line]);
    const session = this.paintSessions(item, parts);
    // What a row offers, at its end: the first as many as the list's `buttons` says as buttons, each kept by all it says — its label and its verb — so a run that changes an action gives it a new button, and a press on the old one comes to nothing rather than doing the new one; the rest behind its kebab, last.
    const shown = this.buttonCount();
    const offered = new Map<string, number>();
    const buttons = item.actions.slice(0, shown).map((action) => {
      const what = actionKey(action);
      const again = offered.get(what) ?? 0;
      offered.set(what, again + 1);
      return parts.actions.draw(`${what}#${again}`, () => this.buildAction(item.key, action));
    });
    parts.actions.sweep();
    // A row naming a session the app has carries that session's menu, which holds the row's actions beyond its buttons too (`kebabItems`).
    const named = item.session !== null && session !== null;
    const kebabLabel = named ? 'Session options' : 'More actions';
    setTooltip(parts.kebab, kebabLabel);
    parts.kebab.setAttribute('aria-label', kebabLabel);
    // The session it shows, before what it offers, so going back comes before starting again.
    placeChildren(row, [content, ...(session ? [session] : []), ...buttons, ...(named || item.actions.length > shown ? [parts.kebab] : [])]);
    return row;
  }

  /** A row's kebab: the menu of the session it names, the row's actions beyond its buttons under its header, or those actions alone when it names no session the app has; null for neither. */
  private kebabItems(key: string): MenuItem[] | null {
    const own = this.moreActions(key) ?? [];
    const id = this.items.get(key)?.session ?? null;
    const menu = id !== null ? this.host.sessionMenu(id, 'panel', own) : null;
    return menu ?? (own.length > 0 ? own : null);
  }

  /** How many of a row's actions show as buttons, as the document on show says. */
  private buttonCount(): number {
    return this.doc?.buttons ?? DEFAULT_BUTTONS;
  }

  /** The items of a row's kebab: its actions beyond its buttons, as the last draw left the row, each asking for its action only if the row still offers it when chosen, since a run may take it away while the menu is up; null for none. */
  private moreActions(key: string): MenuItem[] | null {
    const rest = this.items.get(key)?.actions.slice(this.buttonCount()) ?? [];
    if (rest.length === 0) return null;
    return rest.map((action) => ({
      label: action.label,
      onSelect: () => {
        if (this.items.get(key)?.actions.some((offered) => actionKey(offered) === actionKey(action))) this.perform(key, action.does);
      },
    }));
  }

  /**
   * Carry out a verb for the row as the last draw left it: the one place an action, a row's press and a part's press all end.
   * A `session` only ASKS: the app's dialog shows what would start, and nothing does until Start there.
   */
  private perform(key: string, verb: Verb): void {
    const item = this.items.get(key);
    if (!item) return;
    switch (verb.verb) {
      case 'session':
        this.host.startSession({ from: this.context.from(), key, label: this.said(item.text), href: urlOf(item.press), name: verb.name, prompt: verb.prompt, pr: verb.pr, dir: this.context.dir() });
        return;
      case 'open-session':
        this.host.openSession(verb.id);
        return;
      case 'open-url':
        window.claudeUi.openExternal(verb.url);
        return;
      case 'copy':
        this.host.copyText(verb.text, verb.confirm ?? COPIED);
        return;
    }
  }

  /**
   * One line of a row's detail: its parts in order, the separator between each two, each kept by its place, and a part by what a press on it does too, since a link, a press and plain text are different elements.
   * A part that opens a link is an `<a>` with it, which the list's body sends to the browser (`routeLinks`), so a middle-click opens it too; a part with another verb is an `<a>` without one, drawn as a link is (`list.css`), whose press the row hands to `perform`.
   */
  private drawLine({ el, pieces }: DetailLine, line: DetailPart[], separator: string): HTMLElement {
    const shown = line.flatMap((part, at) => {
      const url = urlOf(part.press);
      const kind = url !== null ? 'link' : part.press !== null ? 'press' : 'text';
      const piece = pieces.draw(`${at}:${kind}`, () => {
        if (kind === 'text') return element('span');
        const made = element('a');
        if (kind === 'press') made.setAttribute('role', 'button');
        return made;
      });
      piece.className = `list-part tone-${part.tone}`;
      piece.textContent = this.said(part.text);
      if (url !== null) piece.setAttribute('href', url);
      if (kind === 'press') this.partPresses.set(piece, part.press!);
      // What the type says on hover, and nothing else: whether a link shows where it goes is the type's to say (decided 2026-10-30).
      setTooltip(piece, this.said(part.tooltip));
      if (at === 0) return [piece];
      const between = pieces.draw(`${at}:separator`, () => element('span', 'list-separator'));
      between.textContent = separator;
      return [between, piece];
    });
    pieces.sweep();
    placeChildren(el, shown);
    return el;
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
    const namedDot = element('span');
    // A press marks it read or unread where it can be marked, as on every session dot; on a dot with nothing to mark it is the row's.
    ackOnClick(namedDot, () => this.items.get(key)?.session ?? null);
    const namedDotBox = element('span', 'list-dot');
    namedDotBox.append(namedDot);
    // The chevron of a row holding rows: the section heading's own caret, in a button of its own so it folds from the keyboard too.
    const fold = element('button', 'icon-btn compact list-fold');
    fold.type = 'button';
    fold.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleRow(key);
    });
    // A part's press wins over the row's, a link in its detail opening itself (`routeLinks`); then the row's own press; a row without one that holds rows folds them.
    row.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('a[href]')) return;
      const partPress = target?.closest('.list-part');
      const verb = (partPress ? this.partPresses.get(partPress) : undefined) ?? this.items.get(key)?.press;
      if (verb) this.perform(key, verb);
      else this.toggleRow(key);
    });
    // What the row offers beyond its buttons, and the menu of the session it names, behind the app's own kebab, last on the row as a session row's is; built once, so a press on it survives a redraw.
    const kebab = kebabButton('list-kebab pair-end', 'More actions', () => this.kebabItems(key));
    return { row, content, line, fold, lead: element('span'), title, text, trail: element('span', 'list-trail'), meta, lines: new Keyed<DetailLine>((shown) => shown.el), mark, dot, count, namedDot, namedDotBox, actions: new Keyed<HTMLButtonElement>((button) => button), kebab };
  }

  /** The button for one of a row's actions, which does its verb for the row as the last draw left it; a session's shows its prompt on hover, and the other verbs nothing, until a type asks for words of its own. */
  private buildAction(key: string, action: ListAction): HTMLButtonElement {
    const button = element('button', 'list-action');
    button.type = 'button';
    button.textContent = action.label;
    setTooltip(button, action.does.verb === 'session' ? action.does.prompt : null);
    button.addEventListener('click', (event) => {
      // Its own click, not the row's press.
      event.stopPropagation();
      this.perform(key, action.does);
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
  /** What holds the detail's lines. */
  meta: HTMLElement;
  /** The detail's lines, each kept by its place. */
  lines: Keyed<DetailLine>;
  /** The mark for the sessions the row started, with its dot and, for several, their count. */
  mark: HTMLButtonElement;
  dot: HTMLElement;
  count: HTMLElement;
  /** The dot of the session the row names (`session`), in the mark's place, and the box around it that holds that place. */
  namedDot: HTMLElement;
  namedDotBox: HTMLElement;
  /** Its action buttons, each kept by all its action says. */
  actions: Keyed<HTMLButtonElement>;
  /** The kebab holding its actions beyond its buttons and the menu of the session it names, on the row only while it has either. */
  kebab: HTMLButtonElement;
}

/** A line of a row's detail, and its parts and the separators between them. */
interface DetailLine {
  el: HTMLElement;
  pieces: Keyed<HTMLElement>;
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
