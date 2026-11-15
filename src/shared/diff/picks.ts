import { DIFF_QUESTIONS, type DiffPicks, type DiffQuestion } from './types';

const isQuestion = (value: unknown): value is DiffQuestion => DIFF_QUESTIONS.includes(value as DiffQuestion);

/**
 * The sound part of a diff panel's kept picks, or null when nothing of it is: read tolerantly, as the rest of a panel's data is.
 * Main's rule, pure, so that the window's checks keep the picks the way main does.
 */
export function soundDiffPicks(value: unknown): DiffPicks | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question } = value as { question?: unknown };
  return isQuestion(question) ? { question } : null;
}
