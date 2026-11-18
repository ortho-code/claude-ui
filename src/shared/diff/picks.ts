import { DIFF_QUESTIONS, DIFF_VIEWS, type DiffPicks, type DiffQuestion, type DiffView } from './types';

const isQuestion = (value: unknown): value is DiffQuestion => DIFF_QUESTIONS.includes(value as DiffQuestion);

export const isDiffView = (value: unknown): value is DiffView => DIFF_VIEWS.includes(value as DiffView);

/**
 * The sound part of a diff panel's kept picks, or null when its question is not sound: read tolerantly, as the rest of a panel's data is.
 * A file that also holds how a diff was drawn, as the panel kept it before the Editor drew diffs, keeps only its question.
 * Main's rule, pure, so that the window's checks keep the picks the way main does.
 */
export function soundDiffPicks(value: unknown): DiffPicks | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question } = value as { question?: unknown };
  return isQuestion(question) ? { question } : null;
}
