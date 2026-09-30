import { fieldsOf } from '../fields';

/**
 * The list document a `list` type's script prints on stdout, and its check. Pure, and tested per rule.
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
  document: ['version', 'badge', 'sections', 'notes'],
  section: ['title', 'shut', 'empty', 'items'],
  item: ['key', 'text', 'detail', 'href', 'tone', 'actions'],
  action: ['label', 'session'],
  session: ['prompt', 'name'],
} as const;

export const TONES = ['normal', 'attention', 'muted', 'danger'] as const;
export type Tone = (typeof TONES)[number];

/** Start a claude session with a prompt, in the project and group the user picks in the app's own dialog. The one action in this version. */
export interface SessionAction {
  label: string;
  prompt: string;
  /** The session's name (`--name`); the app's own new-session label without one. */
  name: string | null;
}

export interface ListItem {
  /** Unique across the document: what a session started from the row is remembered by. */
  key: string;
  text: string;
  detail: string | null;
  /** What a click on the row opens, in the browser. */
  href: string | null;
  tone: Tone;
  actions: SessionAction[];
}

export interface ListSection {
  title: string | null;
  /** Starts folded; only a section with a title can fold, since its title is what stays. */
  shut: boolean;
  /** What an empty section says instead of nothing. */
  empty: string | null;
  items: ListItem[];
}

export interface ListDocument {
  /** The count on the panel's rail icon and in its header; null for none. */
  badge: number | null;
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
    const text = this.text(field('text'), `${at}.text`, true);
    const detail = this.text(field('detail'), `${at}.detail`);
    let href = this.text(field('href'), `${at}.href`);
    if (href !== null && !HTTP.test(href)) {
      this.problems.push(`${at}.href "${href}" is not an http or https link.`);
      href = null;
    }
    const rawTone = field('tone');
    let tone: Tone = 'normal';
    if (rawTone !== undefined) {
      if (TONES.includes(rawTone as Tone)) tone = rawTone as Tone;
      else this.problems.push(`${at}.tone ${JSON.stringify(rawTone)} is not one of ${TONES.join(', ')}.`);
    }
    const actions = this.list(field('actions'), `${at}.actions`, false)
      .map((action, index) => this.action(action, `${at}.actions[${index}]`))
      .filter((action) => action !== null);
    return key !== null && text !== null ? { key, text, detail, href, tone, actions } : null;
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
    const empty = this.text(field('empty'), `${at}.empty`);
    const items = this.list(field('items'), `${at}.items`, true)
      .map((item, index) => this.item(item, `${at}.items[${index}]`))
      .filter((item) => item !== null);
    return { title, shut, empty, items };
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
  const rawBadge = field('badge');
  let badge: number | null = null;
  if (rawBadge !== undefined) {
    if (typeof rawBadge === 'number' && Number.isInteger(rawBadge) && rawBadge >= 0) badge = rawBadge;
    else reader.problems.push('badge is not a whole number, 0 or more.');
  }
  const sections = reader
    .list(field('sections'), 'sections', true)
    .map((section, index) => reader.section(section, `sections[${index}]`))
    .filter((section) => section !== null);
  const notes = reader
    .list(field('notes'), 'notes', false)
    .map((note, index) => reader.text(note, `notes[${index}]`))
    .filter((note) => note !== null);
  if (reader.problems.length > 0) return { doc: null, problems: reader.problems };
  return { doc: { badge, sections, notes }, problems: [] };
}
