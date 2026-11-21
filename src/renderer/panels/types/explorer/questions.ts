import { DIFF_QUESTIONS, type BaseSource, type DiffQuestion, type DiffSummary } from '../../../../shared/diff/types';
import type { MenuItem } from '../../../ui/menu';

/**
 * How the Explorer says its questions: their names, a question with the commits it counts, and what a list is measured from, which the menu over the list and a checkout's own menu both say, alike.
 */

/** Each question's name, as the menus, the button and a checkout's row say it. */
export const QUESTION_NAMES: Record<DiffQuestion, string> = { since: 'Since branched', unpushed: 'Unpushed', uncommitted: 'Uncommitted' };

/** Where a base came from, as the base's tooltip and the base picker say it. */
export const BASE_SOURCE_WORDS: Record<BaseSource, string> = {
  branch: 'Kept for this branch.',
  project: 'Kept for this project.',
  convention: 'Guessed: the default branch of the remote named upstream, or else of origin.',
};

/**
 * The menu a checkout's own question is picked from: its branch and what it is measured from, once git has read it, then Change the base… while it answers Since branched, the one question a base changes, Follow the panel, ticked while it follows the panel's question, and the three questions with the commits each counts there, the one it is set to ticked.
 * `own` is the question it is set to on its own, null while it follows the panel; `pick` sets it, null following the panel again; `changeBase` opens the base picker for the checkout.
 */
export function rootMenu(panel: DiffQuestion, own: DiffQuestion | null, summary: DiffSummary | null, pick: (question: DiffQuestion | null) => void, changeBase: () => void): MenuItem[] {
  const answers = own ?? panel;
  const head: MenuItem[] = summary
    ? [
        { label: summary.branch ?? 'No branch', header: [basePhrases(answers, summary).map((phrase) => phrase.text).join('')] },
        ...(answers === 'since' ? [{ label: 'Change the base…', onSelect: changeBase }, { label: '', separator: true }] : []),
      ]
    : [];
  return [
    ...head,
    { label: `Follow the panel · ${QUESTION_NAMES[panel]}`, checked: own === null, onSelect: () => pick(null) },
    { label: '', separator: true },
    ...questionItems(summary, (question) => question === own, pick),
  ];
}

/** The three questions as menu items, each with the commits `summary` counts for it, said as commits so the number is not read as files, and none where there is no summary. */
export function questionItems(summary: DiffSummary | null, ticked: (question: DiffQuestion) => boolean, pick: (question: DiffQuestion) => void): MenuItem[] {
  const counts = summary?.counts;
  const sizes: Record<DiffQuestion, number | null | undefined> = { since: counts?.ahead, unpushed: counts?.unpushed, uncommitted: undefined };
  return DIFF_QUESTIONS.map((question) => {
    const size = sizes[question];
    const commits = typeof size === 'number' ? ` · ${size} commit${size === 1 ? '' : 's'}` : '';
    return { label: `${QUESTION_NAMES[question]}${commits}`, checked: ticked(question), onSelect: () => pick(question) };
  });
}

/** What a list is measured from, in words, the quieter ones muted: the base and whether it was guessed, and how far the branch is behind it, for Since branched; what the other two questions mean otherwise. */
export function basePhrases(question: DiffQuestion, summary: DiffSummary | null): { text: string; muted: boolean }[] {
  if (!summary) return [];
  if (question === 'unpushed') return [{ text: 'what the next push sends', muted: false }];
  if (question === 'uncommitted') return [{ text: 'on top of the last commit', muted: false }];
  const words: { text: string; muted: boolean }[] = [];
  if (summary.missing) words.push({ text: `${summary.missing} is gone; `, muted: true });
  if (!summary.base) return [...words, { text: 'no base to measure from', muted: false }];
  words.push({ text: `from ${summary.base.ref}`, muted: false });
  if (summary.base.source === 'convention') words.push({ text: ' · guessed', muted: true });
  const behind = summary.counts.behind;
  if (behind) words.push({ text: ` · ${behind} behind`, muted: true });
  return words;
}
