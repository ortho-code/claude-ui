import { element } from './dom';
import { caretIcon } from './svg';
import './card.css';

/**
 * What the sidebar's session list and a list panel draw alike, built in one place so the two cannot drift: the collapsible section heading.
 * Its look is `card.css`, which this module brings with it.
 */

type HeadingTag = 'h2' | 'h3';

/** The parts every collapsible section heading has, appended in this order: a caret, an icon when it is given one, an ellipsizing label and a count pill. */
interface SectionHeading {
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
}

/**
 * A collapsible section heading, its parts in place: what follows them, what the label and the count say, and what a click does are the caller's.
 * The project's and the group's differ in tag and icon, and a list panel's section has no icon.
 */
export function sectionHeading(tag: HeadingTag, iconHtml: string): SectionHeading & { icon: HTMLElement };
export function sectionHeading(tag: HeadingTag): SectionHeading;
export function sectionHeading(tag: HeadingTag, iconHtml?: string): SectionHeading & { icon?: HTMLElement } {
  const heading = element(tag, 'section-heading');
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
