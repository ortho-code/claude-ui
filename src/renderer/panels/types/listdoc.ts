import type { PanelView } from '../contract';
import { fieldsOf } from '../fields';
import { ICON_NAMES, isIconName } from '../icons';
import { ID_PATTERN, SLUG_RULE } from '../layout';

/**
 * The list document a `list` type's script prints on stdout, and its check.
 * Pure, and tested per rule.
 *
 * This is half of the contract a shared type is written against (the manifest, types/folder.ts, is the other), so it has a `version`, and the rule every contract here keeps: a field this build does not know is IGNORED, never refused, so a script written for a later build still draws, and a version this build does not read is refused whole.
 * Everything the app draws from it goes in as text, never as markup, and a link has to be http or https: the script may come from anyone.
 * A document that breaks a rule is refused whole, each mistake named by where it is, rather than drawn in part: a list that silently shows less than the script printed is the same lie as an empty queue.
 */

/** The document's `version`: the one shape this build reads. */
export const LIST_VERSION = 1;

/**
 * The fields of each object in a list document: the ONE place they are named (see fields.ts), which `docs/panel-types.md` is held to by a test.
 */
export const LIST_FIELDS = {
  document: ['version', 'badge', 'views', 'compact', 'separator', 'buttons', 'sections', 'notes'],
  view: ['id', 'label', 'icon'],
  section: ['title', 'shut', 'tooltip', 'empty', 'items'],
  item: ['key', 'lead', 'leadTone', 'text', 'cut', 'trail', 'tooltip', 'detail', 'separator', 'href', 'tone', 'actions', 'children', 'shut'],
  part: ['text', 'href', 'tooltip', 'tone'],
  action: ['label', 'session'],
  session: ['prompt', 'name'],
} as const;

/** What goes between the parts of a row's `detail` lines when neither the row nor the list says. */
export const DEFAULT_SEPARATOR = ' · ';

/** How many of a row's actions show as buttons when the list does not say: the first, the rest behind the row's menu. */
export const DEFAULT_BUTTONS = 1;

export const TONES = ['normal', 'attention', 'positive', 'muted', 'danger'] as const;
export type Tone = (typeof TONES)[number];

/** Where a row's text too long for its line is cut short: at its end, or at its start, keeping its end in view. */
export const CUTS = ['end', 'start'] as const;
export type Cut = (typeof CUTS)[number];

/**
 * Start a claude session with a prompt, in the project and group the user picks in the app's own dialog.
 * The one action in this version.
 */
export interface SessionAction {
  label: string;
  prompt: string;
  /** The session's name (`--name`); the app's own new-session label without one. */
  name: string | null;
}

/** One piece of a line under a row's first: a string the script printed is a part with that text alone. */
export interface DetailPart {
  text: string;
  /** What a press on it opens, in the browser, rather than the row's link; null for none. */
  href: string | null;
  /** What hovering it shows; a link's is shown above where it goes. */
  tooltip: string | null;
  /** Its colour, in the words a row's tone uses. */
  tone: Tone;
}

export interface ListItem {
  /** Unique across the document: what a session started from the row is remembered by. */
  key: string;
  /** A short mark before the text, in a column of its own, such as a letter for a kind. */
  lead: string | null;
  /** The lead's colour, in the words a row's tone uses. */
  leadTone: Tone;
  text: string;
  /** Where the text is cut short when it is too long for its line; cut at its start, it keeps to one line. */
  cut: Cut;
  /** A short text at the end of the first line, such as a count, which the text gives way to. */
  trail: string | null;
  /** What hovering the row's first line shows, such as all of what the text shortens. */
  tooltip: string | null;
  /** The lines under the first, smaller, each its parts in order; empty for none. */
  detail: DetailPart[][];
  /** What goes between the parts of each of its lines: its own, else the list's, else `DEFAULT_SEPARATOR`; not its parent's, so a list says it once for every level. */
  separator: string;
  /** What a click on the row opens, in the browser. */
  href: string | null;
  tone: Tone;
  actions: SessionAction[];
  /** The rows under this one, which it folds away and back; empty for a row that holds none. */
  children: ListItem[];
  /** Starts folded; only a row with children can fold, since they are what it folds. */
  shut: boolean;
}

export interface ListSection {
  title: string | null;
  /** Starts folded; only a section with a title can fold, since its title is what stays. */
  shut: boolean;
  /** What hovering its heading shows, such as all of what the title shortens; only a section with a title has a heading to hover. */
  tooltip: string | null;
  /** What an empty section says instead of nothing. */
  empty: string | null;
  items: ListItem[];
}

export interface ListDocument {
  /** The count on the panel's rail icon and in its header; null for none. */
  badge: number | null;
  /** The ways the script can print the list, the first shown until another is picked; a switch only with two or more, and each id is what the script is given as `CLAUDE_UI_VIEW`. */
  views: PanelView[];
  /** One line a row, without the card around each. */
  compact: boolean;
  /** How many of a row's actions show as buttons, the rest behind the row's menu; `DEFAULT_BUTTONS` without one. */
  buttons: number;
  sections: ListSection[];
  /** Sentences for the panel's note line. */
  notes: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const HTTP = /^https?:\/\//i;

/** One walk of a document: every problem, by where it is, and the keys met so far. */
class Reader {
  readonly problems: string[] = [];
  private readonly keys = new Set<string>();
  /** The list's separator, which a row without its own takes; set once the document's own field is read, before its sections. */
  separator = DEFAULT_SEPARATOR;

  /** An optional string: null when absent, and a problem when it is anything but a string. */
  text(value: unknown, at: string, required = false): string | null {
    if (value === undefined) {
      if (required) this.problems.push(`${at} is missing.`);
      return null;
    }
    if (typeof value !== 'string') {
      this.problems.push(`${at} is not a string.`);
      return null;
    }
    if (required && value.trim() === '') {
      this.problems.push(`${at} is empty.`);
      return null;
    }
    return value;
  }

  /** One of a field's words, such as a tone or a cut: the first of them when absent, and when it is not one of them, which is a problem too. */
  choice<T extends string>(value: unknown, at: string, words: readonly T[]): T {
    if (value === undefined) return words[0]!;
    if (words.includes(value as T)) return value as T;
    this.problems.push(`${at} ${JSON.stringify(value)} is not one of ${words.join(', ')}.`);
    return words[0]!;
  }

  /** An optional whole number, 0 or more, such as the badge: null when absent, and a problem when it is anything else. */
  count(value: unknown, at: string): number | null {
    if (value === undefined) return null;
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
    this.problems.push(`${at} is not a whole number, 0 or more.`);
    return null;
  }

  flag(value: unknown, at: string): boolean {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') this.problems.push(`${at} is not true or false.`);
    return value === true;
  }

  list(value: unknown, at: string, required: boolean): unknown[] {
    if (value === undefined) {
      if (required) this.problems.push(`${at} is missing.`);
      return [];
    }
    if (!Array.isArray(value)) {
      this.problems.push(`${at} is not an array.`);
      return [];
    }
    return value;
  }

  /** A row's lines under its first: an array of lines, each a non-empty array of parts, which a flat array of parts is not. */
  detail(value: unknown, at: string): DetailPart[][] {
    return this.list(value, at, false).map((line, index) => this.line(line, `${at}[${index}]`));
  }

  line(raw: unknown, at: string): DetailPart[] {
    if (!Array.isArray(raw)) {
      this.problems.push(`${at} is not a line, which is an array of parts.`);
      return [];
    }
    if (raw.length === 0) this.problems.push(`${at} is empty.`);
    return raw.map((part, index) => this.part(part, `${at}[${index}]`)).filter((part) => part !== null);
  }

  /** A part of a line: a string, which is its text alone, or an object with its text and what else it says. */
  part(raw: unknown, at: string): DetailPart | null {
    if (typeof raw === 'string') {
      const text = this.text(raw, at, true);
      return text !== null ? { text, href: null, tooltip: null, tone: TONES[0] } : null;
    }
    if (!isObject(raw)) {
      this.problems.push(`${at} is not a string or an object.`);
      return null;
    }
    const field = fieldsOf(raw, LIST_FIELDS.part);
    const text = this.text(field('text'), `${at}.text`, true);
    const href = this.link(field('href'), `${at}.href`);
    const tooltip = this.text(field('tooltip'), `${at}.tooltip`);
    const tone = this.choice(field('tone'), `${at}.tone`, TONES);
    return text !== null ? { text, href, tooltip, tone } : null;
  }

  /** An optional link, a row's or a part's: null when absent, and a problem when it is not http or https, since the app opens it in the browser. */
  link(value: unknown, at: string): string | null {
    const href = this.text(value, at);
    if (href !== null && !HTTP.test(href)) {
      this.problems.push(`${at} "${href}" is not an http or https link.`);
      return null;
    }
    return href;
  }

  action(raw: unknown, at: string): SessionAction | null {
    if (!isObject(raw)) {
      this.problems.push(`${at} is not an object.`);
      return null;
    }
    const field = fieldsOf(raw, LIST_FIELDS.action);
    const label = this.text(field('label'), `${at}.label`, true);
    // An action of a kind this build does not have is a later build's, and is left out like any field it does not know.
    const session = field('session');
    if (session === undefined) return null;
    if (!isObject(session)) {
      this.problems.push(`${at}.session is not an object.`);
      return null;
    }
    const sessionField = fieldsOf(session, LIST_FIELDS.session);
    const prompt = this.text(sessionField('prompt'), `${at}.session.prompt`, true);
    const name = this.text(sessionField('name'), `${at}.session.name`);
    return label !== null && prompt !== null ? { label, prompt, name } : null;
  }

  item(raw: unknown, at: string): ListItem | null {
    if (!isObject(raw)) {
      this.problems.push(`${at} is not an object.`);
      return null;
    }
    const field = fieldsOf(raw, LIST_FIELDS.item);
    const key = this.text(field('key'), `${at}.key`, true);
    if (key !== null) {
      if (this.keys.has(key)) this.problems.push(`${at}.key "${key}" is already used by another item.`);
      this.keys.add(key);
    }
    const lead = this.text(field('lead'), `${at}.lead`);
    const leadTone = this.choice(field('leadTone'), `${at}.leadTone`, TONES);
    const text = this.text(field('text'), `${at}.text`, true);
    const cut = this.choice(field('cut'), `${at}.cut`, CUTS);
    const trail = this.text(field('trail'), `${at}.trail`);
    const tooltip = this.text(field('tooltip'), `${at}.tooltip`);
    const detail = this.detail(field('detail'), `${at}.detail`);
    const separator = this.text(field('separator'), `${at}.separator`) ?? this.separator;
    const href = this.link(field('href'), `${at}.href`);
    const tone = this.choice(field('tone'), `${at}.tone`, TONES);
    const actions = this.list(field('actions'), `${at}.actions`, false)
      .map((action, index) => this.action(action, `${at}.actions[${index}]`))
      .filter((action) => action !== null);
    // Rows under this one, read as rows are, so a key is unique across every level and a mistake is named by its whole path.
    const children = this.list(field('children'), `${at}.children`, false)
      .map((child, index) => this.item(child, `${at}.children[${index}]`))
      .filter((child) => child !== null);
    const shut = this.flag(field('shut'), `${at}.shut`);
    if (shut && children.length === 0) this.problems.push(`${at}.shut needs children, which are what it folds.`);
    return key !== null && text !== null ? { key, lead, leadTone, text, cut, trail, tooltip, detail, separator, href, tone, actions, children, shut } : null;
  }

  /** One of the list's views: an id a layout entry can name and a script can be given, a label and an icon from the app's set; an id used before is a problem, as an item's key is. */
  view(raw: unknown, at: string, ids: Set<string>): PanelView | null {
    if (!isObject(raw)) {
      this.problems.push(`${at} is not an object.`);
      return null;
    }
    const field = fieldsOf(raw, LIST_FIELDS.view);
    let id = this.text(field('id'), `${at}.id`, true);
    if (id !== null && !ID_PATTERN.test(id)) {
      this.problems.push(`${at}.id "${id}" is not a slug (${SLUG_RULE}).`);
      id = null;
    } else if (id !== null && ids.has(id)) this.problems.push(`${at}.id "${id}" is already used by another view.`);
    if (id !== null) ids.add(id);
    const label = this.text(field('label'), `${at}.label`, true);
    const icon = field('icon');
    if (icon === undefined) this.problems.push(`${at}.icon is missing.`);
    else if (!isIconName(icon)) this.problems.push(`${at}.icon ${JSON.stringify(icon)} is not an icon this build has (it has: ${ICON_NAMES.join(', ')}).`);
    return id !== null && label !== null && isIconName(icon) ? { id, label, icon } : null;
  }

  section(raw: unknown, at: string): ListSection | null {
    if (!isObject(raw)) {
      this.problems.push(`${at} is not an object.`);
      return null;
    }
    const field = fieldsOf(raw, LIST_FIELDS.section);
    const title = this.text(field('title'), `${at}.title`);
    const shut = this.flag(field('shut'), `${at}.shut`);
    if (shut && title === null) this.problems.push(`${at}.shut needs a title, which is what stays when it folds.`);
    const tooltip = this.text(field('tooltip'), `${at}.tooltip`);
    if (tooltip !== null && title === null) this.problems.push(`${at}.tooltip needs a title, which is what it shows over.`);
    const empty = this.text(field('empty'), `${at}.empty`);
    const items = this.list(field('items'), `${at}.items`, true)
      .map((item, index) => this.item(item, `${at}.items[${index}]`))
      .filter((item) => item !== null);
    return { title, shut, tooltip, empty, items };
  }
}

/** What a run printed, as a list or as every reason it is not one. */
export type ListRead = { doc: ListDocument; problems: [] } | { doc: null; problems: string[] };

export function readListDocument(stdout: string): ListRead {
  if (stdout.trim() === '') return { doc: null, problems: ['It printed nothing.'] };
  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    return { doc: null, problems: [`What it printed is not JSON: ${(error as Error).message}.`] };
  }
  if (!isObject(json)) return { doc: null, problems: ['What it printed is not a JSON object.'] };
  const field = fieldsOf(json, LIST_FIELDS.document);
  const version = field('version');
  if (version === undefined) return { doc: null, problems: [`version is missing (this build reads ${LIST_VERSION}).`] };
  if (version !== LIST_VERSION) return { doc: null, problems: [`version ${JSON.stringify(version)} is not one this build reads (it reads ${LIST_VERSION}).`] };

  const reader = new Reader();
  const badge = reader.count(field('badge'), 'badge');
  const viewIds = new Set<string>();
  const views = reader
    .list(field('views'), 'views', false)
    .map((view, index) => reader.view(view, `views[${index}]`, viewIds))
    .filter((view) => view !== null);
  const compact = reader.flag(field('compact'), 'compact');
  reader.separator = reader.text(field('separator'), 'separator') ?? DEFAULT_SEPARATOR;
  const buttons = reader.count(field('buttons'), 'buttons') ?? DEFAULT_BUTTONS;
  const sections = reader
    .list(field('sections'), 'sections', true)
    .map((section, index) => reader.section(section, `sections[${index}]`))
    .filter((section) => section !== null);
  const notes = reader
    .list(field('notes'), 'notes', false)
    .map((note, index) => reader.text(note, `notes[${index}]`))
    .filter((note) => note !== null);
  if (reader.problems.length > 0) return { doc: null, problems: reader.problems };
  return { doc: { badge, views, compact, buttons, sections, notes }, problems: [] };
}
