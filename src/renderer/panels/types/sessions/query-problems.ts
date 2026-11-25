import type { Problem } from '../../../../shared/query/parse';
import { fromMarkup } from '../../../ui/dom';
import { container } from './drawn';
import './query-problems.css';

/**
 * What the query field says while its text does not read (the session-model design's decision 223): each term that does not read underlined, why under the field, and the list dimmed, since it still shows the last query that read rather than what the field says.
 * An input cannot style part of its text, so the underline is drawn on a copy of the text laid over the field, its letters transparent, scrolled with it.
 */

/** The copy of the field's text the underlines are drawn on, laid over the field by the filter (filter.ts). */
export const queryMirror = fromMarkup(`<div id="query-mirror" aria-hidden="true"></div>`);
/** Why the query does not read, a line per term, under the field. */
export const queryProblemList = fromMarkup(`<ul id="query-problems" role="status" hidden></ul>`);

/** Copy the field's text into the mirror, each problem's part of it underlined, and keep it scrolled as the field is. */
function drawMirror(text: string, problems: readonly Problem[]): void {
  const parts: Node[] = [];
  let at = 0;
  for (const problem of [...problems].sort((a, b) => a.from - b.from)) {
    if (problem.from < at) continue;
    parts.push(document.createTextNode(text.slice(at, problem.from)));
    const marked = document.createElement('span');
    marked.className = 'query-problem';
    marked.textContent = text.slice(problem.from, problem.to);
    parts.push(marked);
    at = problem.to;
  }
  parts.push(document.createTextNode(text.slice(at)));
  queryMirror.replaceChildren(...parts);
}

/** Keep the mirror scrolled as the field is, so an underline stays under its term in a text longer than the field. */
export function followFieldScroll(field: HTMLInputElement): void {
  queryMirror.scrollLeft = field.scrollLeft;
}

/** Show what the field says of its text: its problems underlined and named, the field and the list marked, or nothing of it while the text reads. */
export function showQueryProblems(field: HTMLInputElement, problems: readonly Problem[]): void {
  drawMirror(field.value, problems);
  followFieldScroll(field);
  queryProblemList.hidden = problems.length === 0;
  queryProblemList.replaceChildren(
    ...problems.map((problem) => {
      const line = document.createElement('li');
      line.textContent = problem.message;
      return line;
    }),
  );
  field.classList.toggle('has-problems', problems.length > 0);
  container.classList.toggle('stale', problems.length > 0);
}
