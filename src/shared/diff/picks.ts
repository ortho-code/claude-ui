import { DEFAULT_DIFF_PICKS, DIFF_QUESTIONS, DIFF_VIEWS, type DiffPicks, type DiffQuestion, type DiffView } from './types';

const isQuestion = (value: unknown): value is DiffQuestion => DIFF_QUESTIONS.includes(value as DiffQuestion);
const isView = (value: unknown): value is DiffView => DIFF_VIEWS.includes(value as DiffView);

/**
 * The sound part of a diff panel's kept picks, each pick that is not sound taking its default, or null when no pick of it is sound: read tolerantly, as the rest of a panel's data is.
 * Main's rule, pure, so that the window's checks keep the picks the way main does.
 */
export function soundDiffPicks(value: unknown): DiffPicks | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question, view, ignoreWs, changesOnly } = value as { question?: unknown; view?: unknown; ignoreWs?: unknown; changesOnly?: unknown };
  if (!isQuestion(question) && !isView(view) && typeof ignoreWs !== 'boolean' && typeof changesOnly !== 'boolean') return null;
  return {
    question: isQuestion(question) ? question : DEFAULT_DIFF_PICKS.question,
    view: isView(view) ? view : DEFAULT_DIFF_PICKS.view,
    ignoreWs: typeof ignoreWs === 'boolean' ? ignoreWs : DEFAULT_DIFF_PICKS.ignoreWs,
    changesOnly: typeof changesOnly === 'boolean' ? changesOnly : DEFAULT_DIFF_PICKS.changesOnly,
  };
}
