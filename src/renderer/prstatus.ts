import { prReference } from '../shared/prs';
import { PR_TYPES } from '../shared/needsyou';
import type { PrNeedsYouType, PrRef, PrSeen, PrStatus, PrStatusRead, SessionSummary } from '../shared/types';
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

/** What a PR's state is called, as the words for why its mark has the tone it has. */
export type PrWords = 'checks failed' | 'merge conflict' | 'changes requested' | 'draft' | 'checks running' | 'review required' | 'approved' | 'open' | 'merged' | 'closed';

/** A PR's standing: the tone its mark takes, and the words for why, null where its status is not known. */
export interface PrVerdict {
  tone: Tone;
  words: PrWords | null;
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

/**
 * What a PR's status holds that needs you, each on its own, where its words name only the strongest (`prVerdict`): failing checks, a conflict, changes requested, an approved review, merged or closed.
 * Apart, so one that was there already does not read as new once a stronger one clears, and an approval shows while checks still run.
 */
function conditionsOf(status: PrStatus): Set<PrNeedsYouType> {
  if (status.state !== 'open') return new Set([status.state === 'merged' ? 'pr.merged' : 'pr.closed']);
  const conditions = new Set<PrNeedsYouType>();
  if (status.checks === 'failed') conditions.add('pr.checks-failed');
  if (status.conflict === true) conditions.add('pr.conflict');
  if (status.review === 'changes-requested') conditions.add('pr.changes-requested');
  if (status.review === 'approved') conditions.add('pr.approved');
  return conditions;
}

/** The order of the PR types, strongest first (`PR_TYPES`). */
const PR_ORDER = Object.keys(PR_TYPES);

/** `types` strongest first, in the order the PR types are named in (`PR_TYPES`). */
export function ranked(types: Iterable<PrNeedsYouType>): PrNeedsYouType[] {
  return [...types].sort((a, b) => PR_ORDER.indexOf(a) - PR_ORDER.indexOf(b));
}

/** What a PR already needs you for, as a first run marks it: everything its status holds that does (`conditionsOf`), strongest first; empty where it needs nothing. */
export function needsYouNow(status: PrStatus): PrNeedsYouType[] {
  return ranked(conditionsOf(status));
}

/** A PR's status with a conflict GitHub has not worked out yet, as it is after a push, taken as what it was before, so a conflict that stays does not read as new each time it comes back. */
function withKnownConflict(status: PrStatus, before: PrStatus | undefined): PrStatus {
  return status.state === 'open' && status.conflict === null && before?.state === 'open' ? { ...status, conflict: before.conflict } : status;
}

/**
 * What main's answer about `prs` changed since `seen`: what is seen now, each PR's status, and each PR whose change needs you, with the type of every change, strongest first (decided 2026-10-29).
 * A PR marks when something that needs you is there now and was not before (`conditionsOf`): checks failing, a conflict, changes requested, an approved review, merged or closed; all of them where several come in one answer, so an approval that comes with failing checks is not lost; and when a closed PR is open again, as reopened, with everything it holds then.
 * So one that was there already marks nothing when a stronger one clears, an approval marks though its checks still run, an approved PR whose checks run again after a push marks nothing, and a conflict GitHub is still working out counts as what was known of it.
 * A PR seen for the first time is recorded and marks nothing, whatever it holds; one with no status keeps what was seen of it; an answer in which any request to GitHub failed changes nothing, and what it did learn waits for the next whole answer.
 */
export function prChanges(seen: PrSeen | null, prs: readonly PrRef[], read: PrStatusRead): { seen: PrSeen | null; changes: { pr: string; types: PrNeedsYouType[] }[] } {
  if (read.problem !== null) return { seen, changes: [] };
  const next: PrSeen = { ...seen };
  const changes: { pr: string; types: PrNeedsYouType[] }[] = [];
  for (const pr of prs) {
    const ref = prReference(pr);
    const answered = read.statuses[ref];
    if (answered === undefined) continue;
    const before = seen?.[ref];
    const status = withKnownConflict(answered, before);
    next[ref] = status;
    if (before === undefined) continue;
    const was = conditionsOf(before);
    // Open again, everything it holds is news: a closed PR held none of it.
    const found = before.state === 'closed' && status.state === 'open' ? ranked(['pr.reopened', ...conditionsOf(status)]) : ranked([...conditionsOf(status)].filter((condition) => !was.has(condition)));
    if (found.length > 0) changes.push({ pr: ref, types: found });
  }
  return { seen: seen === null && prs.every((pr) => read.statuses[prReference(pr)] === undefined) ? null : next, changes };
}

/** The order a session's PRs roll up by, highest first: whatever most needs a person wins, so the mark is muted only once every PR is merged or closed. */
const PR_TONE_ORDER: readonly Tone[] = ['danger', 'attention', 'positive', 'normal', 'muted'];

/** The tone that speaks for several PRs, by `PR_TONE_ORDER`; `normal` for none. */
export function rollUpPrTone(tones: Iterable<Tone>): Tone {
  const all = new Set(tones);
  return PR_TONE_ORDER.find((tone) => all.has(tone)) ?? 'normal';
}

/** How a count of PRs in one state reads: `1 with failing checks`, `2 merged`. */
const COUNTED: Record<PrWords, string> = {
  'checks failed': 'with failing checks',
  'merge conflict': 'with a merge conflict',
  'changes requested': 'with changes requested',
  draft: 'in draft',
  'checks running': 'with checks running',
  'review required': 'awaiting review',
  approved: 'approved',
  open: 'open',
  merged: 'merged',
  closed: 'closed',
};

/** What a session's PR mark shows: the tone its PRs roll up to, and what set it or why there is no status, null with nothing to say. */
export interface PrMark {
  tone: Tone;
  says: string | null;
}

/**
 * A PR's verdict from main's answer: as if it had no status while main could not ask GitHub, whatever status it still holds from before, so a status that may be stale never colours anything.
 * What the mark and a PR's menu item both take it from.
 */
export function verdictOf(pr: PrRef, read: PrStatusRead): PrVerdict {
  return prVerdict(read.problem === null ? (read.statuses[prReference(pr)] ?? null) : null);
}

/** The mark for `prs` from main's answer: their roll-up tone, and the PRs that set it counted by state, `1 with failing checks`; when main could not ask GitHub, `normal`, saying why. */
export function prMark(prs: readonly PrRef[], read: PrStatusRead): PrMark {
  if (read.problem !== null) return { tone: 'normal', says: `no status: ${read.problem}` };
  const verdicts = prs.map((pr) => verdictOf(pr, read));
  const tone = rollUpPrTone(verdicts.map((verdict) => verdict.tone));
  const counts = new Map<PrWords, number>();
  for (const verdict of verdicts) if (verdict.tone === tone && verdict.words !== null) counts.set(verdict.words, (counts.get(verdict.words) ?? 0) + 1);
  return { tone, says: [...counts].map(([words, count]) => `${count} ${COUNTED[words]}`).join(', ') || null };
}
