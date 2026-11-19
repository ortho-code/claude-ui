import { DIFF_QUESTIONS, type BaseSource, type DiffQuestion, type DiffSummary } from '../../../../shared/diff/types';
import { element } from '../../../ui/dom';
import { openMenu, type MenuItem } from '../../../ui/menu';
import { menuCaret } from '../../../ui/menu-caret';
import { mutedText } from '../../../ui/muted';
import { layersIcon } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import './toolbar.css';

/**
 * The Explorer's row over its list: which question the list answers, as a menu of the three, and what it is measured from.
 */

/** Each question's name, as the menu and the button say it. */
export const QUESTION_NAMES: Record<DiffQuestion, string> = { since: 'Since branched', unpushed: 'Unpushed', uncommitted: 'Uncommitted' };

/** The jump button's label and tooltip. */
const JUMP = 'Jump to a checkout';

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
  private readonly caret = menuCaret();
  private readonly base = element('span', 'diff-base');
  /** Jumps to one of the roots, as a project heading's button jumps to one of its groups; hidden below two. */
  private readonly jumpButton = element('button', 'icon-btn compact explorer-jump');

  constructor(
    private readonly current: () => DiffQuestion,
    private readonly summary: () => DiffSummary | null,
    private readonly pick: (question: DiffQuestion) => void,
    private readonly jumps: () => MenuItem[],
  ) {
    this.button.type = 'button';
    this.button.append(this.label, this.caret);
    this.button.title = 'Pick what the list shows';
    this.button.addEventListener('click', () => openMenu(this.button, this.items()));
    this.jumpButton.type = 'button';
    this.jumpButton.innerHTML = layersIcon(14);
    this.jumpButton.setAttribute('aria-label', JUMP);
    setTooltip(this.jumpButton, JUMP);
    // Listed again as the window's state changes while it is open, and closed once there is nowhere else to jump, as a project heading's jump is; a new read of a checkout alone does not list it again.
    this.jumpButton.addEventListener('click', () => openMenu(this.jumpButton, this.jumps(), () => (this.jumps().length < 2 ? null : this.jumps())));
    this.el.append(this.button, this.base, this.jumpButton);
  }

  draw(): void {
    const question = this.current();
    this.label.textContent = QUESTION_NAMES[question];
    const summary = this.summary();
    this.base.replaceChildren(...this.baseWords(question, summary));
    this.base.title = question === 'since' && summary?.base ? SOURCE_WORDS[summary.base.source] : '';
    this.jumpButton.hidden = this.jumps().length < 2;
  }

  /** The three questions, the one on show ticked, each with the commits it counts where it counts any, said as commits, so the number is not read as files. */
  private items(): MenuItem[] {
    const counts = this.summary()?.counts;
    const sizes: Record<DiffQuestion, number | null | undefined> = { since: counts?.ahead, unpushed: counts?.unpushed, uncommitted: undefined };
    return DIFF_QUESTIONS.map((question) => {
      const size = sizes[question];
      const commits = typeof size === 'number' ? ` · ${size} commit${size === 1 ? '' : 's'}` : '';
      return { label: `${QUESTION_NAMES[question]}${commits}`, checked: question === this.current(), onSelect: () => this.pick(question) };
    });
  }

  /** What the list is measured from, in words: the base and whether it was guessed, and how far the branch is behind it, for Since branched; what the other two questions mean otherwise. */
  private baseWords(question: DiffQuestion, summary: DiffSummary | null): Node[] {
    if (!summary) return [];
    if (question === 'unpushed') return [text('what the next push sends')];
    if (question === 'uncommitted') return [text('on top of the last commit')];
    const words: Node[] = [];
    if (summary.missing) words.push(mutedText(`${summary.missing} is gone; `));
    if (!summary.base) return [...words, text('no base to measure from')];
    words.push(text(`from ${summary.base.ref}`));
    if (summary.base.source === 'convention') words.push(mutedText(' · guessed'));
    const behind = summary.counts.behind;
    if (behind) words.push(mutedText(` · ${behind} behind`));
    return words;
  }
}

const text = (words: string): Text => document.createTextNode(words);
