import { DIFF_QUESTIONS, type BaseSource, type DiffQuestion, type DiffSummary } from '../../../../shared/diff/types';
import { element } from '../../../ui/dom';
import { openMenu, type MenuItem } from '../../../ui/menu';
import { caretIcon } from '../../../ui/svg';
import { setMarkup } from '../../../ui/keyed';
import './toolbar.css';

/**
 * The diff panel's row over its list: which question the list answers, as a menu of the three, and what it is measured from.
 */

/** Each question's name, as the menu and the button say it. */
export const QUESTION_NAMES: Record<DiffQuestion, string> = { since: 'Since branched', unpushed: 'Unpushed', uncommitted: 'Uncommitted' };

/** Where a base came from, as its tooltip says it. */
const SOURCE_WORDS: Record<BaseSource, string> = {
  branch: 'Kept for this branch.',
  project: 'Kept for this project.',
  convention: 'Guessed: the default branch of the remote named upstream, or else of origin.',
};

export class Toolbar {
  readonly el = element('div', 'diff-toolbar');
  private readonly button = element('button', 'diff-question');
  private readonly label = element('span');
  private readonly caret = element('span', 'diff-question-caret');
  private readonly base = element('span', 'diff-base');

  constructor(
    private readonly current: () => DiffQuestion,
    private readonly summary: () => DiffSummary | null,
    private readonly pick: (question: DiffQuestion) => void,
  ) {
    this.button.type = 'button';
    setMarkup(this.caret, caretIcon(false, 10));
    this.button.append(this.label, this.caret);
    this.button.title = 'Pick what the list shows';
    this.button.addEventListener('click', () => openMenu(this.button, this.items()));
    this.el.append(this.button, this.base);
  }

  draw(): void {
    const question = this.current();
    this.label.textContent = QUESTION_NAMES[question];
    const summary = this.summary();
    this.base.replaceChildren(...this.baseWords(question, summary));
    this.base.title = question === 'since' && summary?.base ? SOURCE_WORDS[summary.base.source] : '';
  }

  /** The three questions, the one on show ticked, each with the commits it counts where it counts any. */
  private items(): MenuItem[] {
    const counts = this.summary()?.counts;
    const sizes: Record<DiffQuestion, number | null | undefined> = { since: counts?.ahead, unpushed: counts?.unpushed, uncommitted: undefined };
    return DIFF_QUESTIONS.map((question) => ({
      label: QUESTION_NAMES[question],
      checked: question === this.current(),
      ...(typeof sizes[question] === 'number' ? { count: sizes[question] } : {}),
      onSelect: () => this.pick(question),
    }));
  }

  /** What the list is measured from, in words: the base and whether it was guessed, and how far the branch is behind it, for Since branched; what the other two questions mean otherwise. */
  private baseWords(question: DiffQuestion, summary: DiffSummary | null): Node[] {
    if (!summary) return [];
    if (question === 'unpushed') return [text('what the next push sends')];
    if (question === 'uncommitted') return [text('on top of the last commit')];
    const words: Node[] = [];
    if (summary.missing) words.push(muted(`${summary.missing} is gone; `));
    if (!summary.base) return [...words, text('no base to measure from')];
    words.push(text(`from ${summary.base.ref}`));
    if (summary.base.source === 'convention') words.push(muted(' · guessed'));
    const behind = summary.counts.behind;
    if (behind) words.push(muted(` · ${behind} behind`));
    return words;
  }
}

const text = (words: string): Text => document.createTextNode(words);

function muted(words: string): HTMLElement {
  const span = element('span', 'diff-muted');
  span.textContent = words;
  return span;
}
