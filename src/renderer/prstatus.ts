import { prReference } from '../shared/prs';
import type { PrRef, PrStatus, PrStatusRead, SessionSummary } from '../shared/types';
import type { Tone } from './tone';

/** Main's answer before it has given one: no status for any PR, and nothing gone wrong. */
export const NO_PR_STATUS: PrStatusRead = { statuses: {}, problem: null };

/** Every PR the sessions link, once each, in the order the listing first names them: what main is asked about. */
export function linkedPrs(sessions: readonly Pick<SessionSummary, 'prs'>[]): PrRef[] {
  const linked = new Map<string, PrRef>();
  for (const session of sessions) {
    for (const { repository, number } of session.prs) {
      const key = prReference({ repository, number });
      if (!linked.has(key)) linked.set(key, { repository, number });
    }
  }
  return [...linked.values()];
}

const MINUTE = 60_000;

/**
 * When to ask main again after it answered `read` about `prs`: in a minute while any open PR's checks run, in five while any PR could still change — open, closed, or with no status — or main could not ask, and never once every one is merged.
 */
export function nextAsk(prs: readonly PrRef[], read: PrStatusRead): number | 'off' {
  const statuses = prs.map((pr) => read.statuses[prReference(pr)]);
  if (statuses.some((status) => status?.state === 'open' && status.checks === 'running')) return MINUTE;
  if (read.problem !== null || statuses.some((status) => status?.state !== 'merged')) return 5 * MINUTE;
  return 'off';
}

/** A PR's standing: the tone its mark takes, and the words for why, null where its status is not known. */
export interface PrVerdict {
  tone: Tone;
  words: string | null;
}

/**
 * How a PR's status colours its mark, a PR taking the first rung it meets, highest first:
 * - `danger`: its checks failed, or it conflicts with its base;
 * - `attention`: changes were requested;
 * - `positive`: approved, not a draft, its checks passed or it has none, and no conflict — ready to merge;
 * - `normal`: open and none of the above — a draft, running checks, a review required, approved with a conflict GitHub has not worked out yet, or no review decision at all;
 * - `muted`: merged or closed.
 * A PR whose status is not known is `normal`, which sets no colour of its own.
 */
export function prVerdict(status: PrStatus | null): PrVerdict {
  if (status === null) return { tone: 'normal', words: null };
  if (status.state !== 'open') return { tone: 'muted', words: status.state };
  if (status.checks === 'failed') return { tone: 'danger', words: 'checks failed' };
  if (status.conflict === true) return { tone: 'danger', words: 'merge conflict' };
  if (status.review === 'changes-requested') return { tone: 'attention', words: 'changes requested' };
  if (status.draft) return { tone: 'normal', words: 'draft' };
  if (status.checks === 'running') return { tone: 'normal', words: 'checks running' };
  if (status.review === 'review-required') return { tone: 'normal', words: 'review required' };
  if (status.review === 'approved') return { tone: status.conflict === false ? 'positive' : 'normal', words: 'approved' };
  return { tone: 'normal', words: 'open' };
}

/** The order a session's PRs roll up by, highest first: whatever most needs a person wins, so the mark is muted only once every PR is merged or closed. */
const PR_TONE_ORDER: readonly Tone[] = ['danger', 'attention', 'positive', 'normal', 'muted'];

/** The tone that speaks for several PRs, by `PR_TONE_ORDER`; `normal` for none. */
export function rollUpPrTone(tones: Iterable<Tone>): Tone {
  const all = new Set(tones);
  return PR_TONE_ORDER.find((tone) => all.has(tone)) ?? 'normal';
}
