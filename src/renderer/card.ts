import { element } from './dom';
import { caretIcon } from './svg';
import './card.css';

/**
 * What the sidebar's session list and a list panel draw alike, built in one place so the two cannot drift: the collapsible section heading, and the card an item in a list sits on.
 * Its look is `card.css`, which this module brings with it.
 */

/** A heading's level: a project's, at the top of the sidebar's list, or the bar one level below it, which a group and a list panel's section wear. */
type HeadingLevel = 'project' | 'bar';

/** The parts every collapsible section heading has, appended in this order: a caret, an icon when it is given one, an ellipsizing label and a count pill. */
interface SectionHeading {
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
}

/**
 * A collapsible section heading, its parts in place: what follows them, what the label and the count say, and what a click does are the caller's.
 * The project's and the group's differ in level and icon, and a list panel's section has no icon.
 */
export function sectionHeading(level: HeadingLevel, iconHtml: string): SectionHeading & { icon: HTMLElement };
export function sectionHeading(level: HeadingLevel): SectionHeading;
export function sectionHeading(level: HeadingLevel, iconHtml?: string): SectionHeading & { icon?: HTMLElement } {
  const heading = level === 'project' ? element('h2', 'section-heading') : element('h3', 'section-heading bar');
  const caret = element('span', 'caret');
  const label = element('span', 'label');
  const count = element('span', 'heading-count');
  if (iconHtml === undefined) {
    heading.append(caret, label, count);
    return { heading, caret, label, count };
  }
  const icon = element('span', 'heading-icon');
  icon.innerHTML = iconHtml;
  heading.append(caret, icon, label, count);
  return { heading, caret, icon, label, count };
}

/** Turn a heading's caret to say whether its section is folded. */
export function setFolded(caret: HTMLElement, folded: boolean): void {
  caret.innerHTML = caretIcon(folded, 10);
}

/** The parts of a card: the title sits in the content and the content in the card; the meta line is made but not placed. */
interface Card {
  card: HTMLElement;
  content: HTMLElement;
  title: HTMLElement;
  meta: HTMLElement;
}

/**
 * A card, an item in a list, with `modifier` for the surface's own rules (`session`, `list-row`).
 * The caller places the meta line, under the title or in a line of its own beside marks, and adds whatever else the card holds around the content.
 * A card is pressed as a whole; one with nothing to press takes `still`, which drops the pointer and the hover.
 */
export function listCard(modifier: string): Card {
  const card = element('article', `card ${modifier}`);
  const content = element('div', 'card-content');
  const title = element('p', 'card-title');
  const meta = element('p', 'card-meta');
  content.append(title);
  card.append(content);
  return { card, content, title, meta };
}
