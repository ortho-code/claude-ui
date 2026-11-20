import type { BaseSource, DiffQuestion, DiffSummary } from '../../../../shared/diff/types';
import { basePhrases, QUESTION_NAMES, questionItems } from './questions';
import { element } from '../../../ui/dom';
import { openMenu, type MenuItem } from '../../../ui/menu';
import { menuCaret } from '../../../ui/menu-caret';
import { drawCollapseAll } from '../../../ui/collapse-all';
import { mutedText } from '../../../ui/muted';
import { unavailable } from '../../../ui/unavailable';
import { layersIcon } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import './toolbar.css';

/**
 * The Explorer's row over its list: which question the list answers, as a menu of the three, and what it is measured from.
 */

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
  /** Folds every root and folder of the list, or opens them all again, drawn as the session list's collapse-all is. */
  private readonly foldButton = element('button', 'icon-btn compact explorer-fold-all');
  /** Jumps to one of the roots, as a project heading's button jumps to one of its groups; hidden below two. */
  private readonly jumpButton = element('button', 'icon-btn compact explorer-jump');

  /**
   * `current` is the panel's question, or `mixed` while a checkout answers another; `summary` what it is measured from and counts, null where the toolbar says neither; `own` how many checkouts are set to a question of their own.
   */
  constructor(
    private readonly current: () => DiffQuestion | 'mixed',
    private readonly summary: () => DiffSummary | null,
    private readonly own: () => number,
    private readonly pick: (question: DiffQuestion) => void,
    private readonly jumps: () => MenuItem[],
    private readonly folds: { all(): boolean; any(): boolean; toggle(): void },
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
    this.foldButton.type = 'button';
    this.foldButton.addEventListener('click', () => {
      if (!unavailable(this.foldButton)) this.folds.toggle();
    });
    this.el.append(this.button, this.base, this.foldButton, this.jumpButton);
    // Labelled from the start, unavailable until the first read gives it a root to fold.
    this.drawFolds();
  }

  draw(): void {
    const question = this.current();
    this.label.textContent = question === 'mixed' ? MIXED : QUESTION_NAMES[question];
    this.button.classList.toggle('mixed', question === 'mixed');
    const summary = question === 'mixed' ? null : this.summary();
    this.base.replaceChildren(...(question === 'mixed' ? [] : basePhrases(question, summary).map((phrase) => (phrase.muted ? mutedText(phrase.text) : text(phrase.text)))));
    this.base.title = question === 'since' && summary?.base ? SOURCE_WORDS[summary.base.source] : '';
    this.jumpButton.hidden = this.jumps().length < 2;
    this.drawFolds();
  }

  /** The collapse-all as the list's folds now stand: unavailable, with why, while there is nothing to fold. */
  drawFolds(): void {
    drawCollapseAll(this.foldButton, this.folds.all(), this.folds.any() ? null : 'Nothing to collapse.');
  }

  /** The three questions, the one on show ticked, none while Mixed, then, while Mixed, how many checkouts are set on their own; each question with the commits it counts where the toolbar counts any. */
  private items(): MenuItem[] {
    const current = this.current();
    const own = this.own();
    const questions = questionItems(this.summary(), (question) => question === current, this.pick);
    if (current !== 'mixed') return questions;
    return [{ label: `${own} checkout${own === 1 ? '' : 's'} set on ${own === 1 ? 'its' : 'their'} own`, header: ['A pick here sets every checkout.'] }, ...questions];
  }
}

/** What the toolbar says while its checkouts answer different questions. */
const MIXED = 'Mixed';

const text = (words: string): Text => document.createTextNode(words);
