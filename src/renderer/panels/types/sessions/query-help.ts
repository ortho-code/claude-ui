import type { Field, FieldRegistry } from '../../../../shared/query/field';
import { store } from '../../../state/app';
import { queryFields } from '../../../state/query-facts';
import { fromMarkup } from '../../../ui/dom';
import { sidePopover } from '../../../ui/side-popover';
import { strokeIcon } from '../../../ui/svg';
import './query-help.css';

/**
 * The query field's help (the session-model design's decision 226): a button beside the field opening, beside the session list, the syntax and every field with its values, drawn from the fields' list as it stands when it opens, and a link to the guide's page on queries.
 * A value is a button that adds its term to the query.
 */

/** Where the guide's page on queries is read, on the repository's main branch. */
const GUIDE_URL = 'https://github.com/ortho-code/claude-ui/blob/main/docs/guide/queries.md';

/** The syntax, an example and what it means each. */
const SYNTAX: readonly [string, string][] = [
  ['fix login', 'each word, anywhere'],
  ['"fix login"', 'the words together; also for a word starting with -, or with : ( )'],
  ['is:pinned has:pr', 'both'],
  ['is:pinned OR is:running', 'either'],
  ['-is:pinned', 'not'],
  ['pr.state:merged,closed', 'any of these values'],
];

/** Days a moment field's buttons offer: the forms a day is written in. */
const DAY_EXAMPLES = ['today', '>=today-7d', '<today-30d'];

const helpIcon = (size: number): string => strokeIcon(size, '<circle cx="8" cy="8" r="6" /><path d="M6.3 6.2a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4" /><path d="M8 11.4v.1" />');

/** The button beside the field, placed by the filter (filter.ts). */
export const queryHelpButton = fromMarkup(
  `<button id="query-help" type="button" class="icon-btn" data-tooltip="How to write a query" aria-label="How to write a query" aria-expanded="false">${helpIcon(14)}</button>`,
  HTMLButtonElement,
);

const popover = sidePopover('query-help-card', 'How to write a query');

function cell(...nodes: (Node | string)[]): HTMLTableCellElement {
  const td = document.createElement('td');
  td.append(...nodes);
  return td;
}

function code(text: string): HTMLElement {
  const el = document.createElement('code');
  el.textContent = text;
  return el;
}

function muted(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'query-help-muted';
  el.textContent = text;
  return el;
}

function table(rows: HTMLTableRowElement[]): HTMLTableElement {
  const el = document.createElement('table');
  el.className = 'query-help-table';
  el.append(...rows);
  return el;
}

function section(title: string, content: HTMLElement): HTMLElement {
  const el = document.createElement('section');
  const heading = document.createElement('h3');
  heading.textContent = title;
  el.append(heading, content);
  return el;
}

/** A value's button, which adds its term to the query. */
function valueButton(term: string, value: string, add: (term: string) => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'query-help-value';
  button.textContent = value;
  button.addEventListener('click', () => add(term));
  return button;
}

/** What a field takes: its values or day forms as buttons, or in words what else it reads. */
function values(field: Field, add: (term: string) => void): Node[] {
  const listed = field.kind === 'moment' ? DAY_EXAMPLES : (field.values ?? []).map((value) => value.value);
  const buttons = listed.map((value) => valueButton(`${field.name}:${value}`, value, add));
  if (field.kind === 'text') return buttons.length > 0 ? [...buttons, muted('or text, as part of it')] : [muted('text, as part of it')];
  if (field.kind === 'moment') return [...buttons, muted('or a date, 2026-11-01')];
  return field.accepts ? [...buttons, muted('or a number, owner/repo#12')] : buttons;
}

function fieldRow(field: Field, add: (term: string) => void): HTMLTableRowElement {
  const row = document.createElement('tr');
  const name = cell(code(`${field.name}:`), muted(field.words));
  name.className = 'query-help-name';
  row.append(name, cell(...values(field, add)));
  return row;
}

/** The card's content from the fields as they stand. */
function content(registry: FieldRegistry, add: (term: string) => void): Node[] {
  const syntax = table(
    SYNTAX.map(([term, words]) => {
      const row = document.createElement('tr');
      const example = cell(code(term));
      example.className = 'query-help-name';
      row.append(example, cell(muted(words)));
      return row;
    }),
  );
  const guide = document.createElement('a');
  guide.href = GUIDE_URL;
  guide.className = 'query-help-guide';
  guide.textContent = 'The full guide to queries';
  guide.addEventListener('click', (event) => {
    event.preventDefault();
    window.claudeUi.openExternal(GUIDE_URL);
  });
  const foot = document.createElement('div');
  foot.className = 'query-help-foot';
  foot.append(muted('Press a value to add it.'), guide);
  return [section('Syntax', syntax), section('Fields', table([...registry.fields.values()].map((field) => fieldRow(field, add)))), foot];
}

/** Open the help beside `beside`, the panel the field is in, or shut it; a value pressed in it goes to `add`. */
export function toggleQueryHelp(beside: HTMLElement, add: (term: string) => void): void {
  popover.toggle(queryHelpButton, beside, () => content(queryFields(store.get()), add));
}
