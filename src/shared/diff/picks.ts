import { DIFF_QUESTIONS, DIFF_VIEWS, type DiffPicks, type DiffQuestion, type DiffView } from './types';

const isQuestion = (value: unknown): value is DiffQuestion => DIFF_QUESTIONS.includes(value as DiffQuestion);

export const isDiffView = (value: unknown): value is DiffView => DIFF_VIEWS.includes(value as DiffView);

/**
 * The sound part of an Explorer's kept picks, or null when its question is not sound: read tolerantly, as the rest of a panel's data is.
 * A checkout's own question that is not sound is dropped, the rest kept.
 * A file that also holds how a diff was drawn, as the panel kept it before the Editor drew diffs, keeps only its questions.
 * Main's rule, pure, so that the window's checks keep the picks the way main does.
 */
export function soundDiffPicks(value: unknown): DiffPicks | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question, roots } = value as { question?: unknown; roots?: unknown };
  if (!isQuestion(question)) return null;
  const own = typeof roots === 'object' && roots !== null ? Object.entries(roots).filter((entry): entry is [string, DiffQuestion] => isQuestion(entry[1])) : [];
  return own.length ? { question, roots: Object.fromEntries(own) } : { question };
}

/** The question the checkout at `root` answers: its own, where it is set to one, else the panel's. */
export const questionOf = (picks: DiffPicks, root: string): DiffQuestion => picks.roots?.[root] ?? picks.question;

/** Those of `roots` set to a question of their own, the panel's own question included. */
export const setOnTheirOwn = (picks: DiffPicks, roots: readonly string[]): string[] => roots.filter((root) => picks.roots?.[root] !== undefined);

/** The picks with the checkout at `root` set to `question` on its own, or following the panel again for null. */
export function withRootQuestion(picks: DiffPicks, root: string, question: DiffQuestion | null): DiffPicks {
  const roots = Object.fromEntries(Object.entries(picks.roots ?? {}).filter(([each]) => each !== root));
  if (question !== null) roots[root] = question;
  return Object.keys(roots).length ? { question: picks.question, roots } : { question: picks.question };
}
