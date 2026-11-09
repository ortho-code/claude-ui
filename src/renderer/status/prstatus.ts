import { approvalsRequired, prKey, prReference, type Approvals } from '../../shared/sessions/prs';
import { PR_TYPES } from '../../shared/status/needsyou';
import type { SettingsView } from '../../shared/config/settings';
import type { PrNeedsYouType, PrRef, PrRole, PrSeen, PrStatus, PrStatusRead, SessionSummary } from '../../shared/types';
import type { Tone } from '../ui/tone';

/** Main's answer before it has given one: no status for any PR, and nothing gone wrong. */
export const NO_PR_STATUS: PrStatusRead = { statuses: {}, problem: null };

/** Every PR the sessions link, once each (`prKey`), as first spelt, in the order the listing first names them: what main is asked about. */
export function linkedPrs(sessions: readonly Pick<SessionSummary, 'prs'>[]): PrRef[] {
  const linked = new Map<string, PrRef>();
  for (const session of sessions) {
    for (const { repository, number } of session.prs) {
      const key = prKey({ repository, number });
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
  const statuses = prs.map((pr) => read.statuses[prKey(pr)]);
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

type OpenStatus = Extract<PrStatus, { state: 'open' }>;

/**
 * Whether an open PR counts as approved: GitHub says so, and where the repository needs a number of approvals (`required`), it has that many.
 * The number only raises GitHub's bar, never lowers it (decided 2026-11-06): a PR GitHub does not call approved would not merge.
 * A count not known falls short of any number.
 */
function isApproved(status: OpenStatus, required: number | null): boolean {
  return status.review === 'approved' && (required === null || (status.approvals ?? 0) >= required);
}

/**
 * How a PR's status colours its mark, a PR taking the first rung it meets, highest first:
 * - `danger`: its checks failed, or it conflicts with its base;
 * - `attention`: changes were requested;
 * - `positive`: approved (`isApproved`), not a draft, its checks passed or it has none, and no conflict — ready to merge;
 * - `normal`: open and none of the above — a draft, running checks, a review required, approved by fewer than the repository's number, approved with a conflict GitHub has not worked out yet, or no review decision at all;
 * - `muted`: merged or closed.
 * A PR whose status is not known is `normal`, which sets no colour of its own.
 * `required` is the approvals the PR's repository needs, null for GitHub's decision alone.
 */
export function prVerdict(status: PrStatus | null, required: number | null): PrVerdict {
  if (status === null) return { tone: 'normal', words: null };
  if (status.state !== 'open') return { tone: 'muted', words: status.state };
  if (status.checks === 'failed') return { tone: 'danger', words: 'checks failed' };
  if (status.conflict === true) return { tone: 'danger', words: 'merge conflict' };
  if (status.review === 'changes-requested') return { tone: 'attention', words: 'changes requested' };
  if (status.draft) return { tone: 'normal', words: 'draft' };
  if (status.checks === 'running') return { tone: 'normal', words: 'checks running' };
  if (status.review === 'review-required' || (status.review === 'approved' && !isApproved(status, required))) return { tone: 'normal', words: 'review required' };
  if (status.review === 'approved') return { tone: status.conflict === false ? 'positive' : 'normal', words: 'approved' };
  return { tone: 'normal', words: 'open' };
}

/**
 * What a PR's status holds that needs you, each on its own, where its words name only the strongest (`prVerdict`): failing checks, a conflict, changes requested, an approval that counts (`isApproved`), commits since your review, a request for your review, merged or closed.
 * Apart, so one that was there already does not read as new once a stronger one clears, and an approval shows while checks still run.
 */
function conditionsOf(status: PrStatus, required: number | null): Set<PrNeedsYouType> {
  if (status.state !== 'open') return new Set([status.state === 'merged' ? 'pr.merged' : 'pr.closed']);
  const conditions = new Set<PrNeedsYouType>();
  if (status.checks === 'failed') conditions.add('pr.checks-failed');
  if (status.conflict === true) conditions.add('pr.conflict');
  if (status.review === 'changes-requested') conditions.add('pr.changes-requested');
  if (isApproved(status, required)) conditions.add('pr.approved');
  if (status.newCommits === true) conditions.add('pr.new-commits');
  if (status.reviewAsked === true) conditions.add('pr.review-requested');
  return conditions;
}

/** The order of the PR types, strongest first (`PR_TYPES`). */
const PR_ORDER = Object.keys(PR_TYPES);

/** `types` strongest first, in the order the PR types are named in (`PR_TYPES`). */
export function ranked(types: Iterable<PrNeedsYouType>): PrNeedsYouType[] {
  return [...types].sort((a, b) => PR_ORDER.indexOf(a) - PR_ORDER.indexOf(b));
}

/** What a PR already needs you for, as a first run marks it: everything its status holds that does (`conditionsOf`), strongest first; empty where it needs nothing. */
export function needsYouNow(status: PrStatus, required: number | null): PrNeedsYouType[] {
  return ranked(conditionsOf(status, required));
}

/** A PR's status with a conflict GitHub has not worked out yet, as it is after a push, taken as what it was before, so a conflict that stays does not read as new each time it comes back. */
function withKnownConflict(status: PrStatus, before: PrStatus | undefined): PrStatus {
  return status.state === 'open' && status.conflict === null && before?.state === 'open' ? { ...status, conflict: before.conflict } : status;
}

/**
 * Whether a review asking for changes came that was not there before, a second reviewer's or a new round of the same one's, though the PR asked for changes already: GitHub's decision stays changes requested throughout, so only the reviews tell it.
 * False where either side does not know its reviews.
 */
function asksForChangesAnew(before: PrStatus, status: PrStatus): boolean {
  if (before.state !== 'open' || status.state !== 'open' || before.changesRequested === null || status.changesRequested === null) return false;
  const seen = new Set(before.changesRequested);
  return status.changesRequested.some((id) => !seen.has(id));
}

/**
 * What was seen of an open PR, with each review field it did not know, as a status kept before the app asked them has not, taken from `status`, what is seen now: so a field coming to be known is not news, and a PR already waiting on you then marks nothing until it changes.
 * Neither open, `before` is as it was.
 */
function withFieldsKnown(before: PrStatus, status: PrStatus): PrStatus {
  if (before.state !== 'open' || status.state !== 'open') return before;
  return { ...before, approvals: before.approvals ?? status.approvals, newCommits: before.newCommits ?? status.newCommits, reviewAsked: before.reviewAsked ?? status.reviewAsked, changesRequested: before.changesRequested ?? status.changesRequested };
}

/**
 * What main's answer about `prs` changed since `seen`: what is seen now, each PR's status, and each PR whose change needs you, with the type of every change, strongest first (decided 2026-10-29).
 * A PR marks when something that needs you is there now and was not before (`conditionsOf`): checks failing, a conflict, changes requested, an approved review, commits since your review, a request for your review, merged or closed; all of them where several come in one answer, so an approval that comes with failing checks is not lost; and when a closed PR is open again, as reopened, with everything it holds then.
 * Commits since your review mark once per review: a second push before you review again finds them there already (decided 2026-11-06).
 * Changes requested marks again for a request that was not there before while one already stands (`asksForChangesAnew`, decided 2026-11-06).
 * A review field the status seen before did not know counts as what is seen now (`withFieldsKnown`).
 * So one that was there already marks nothing when a stronger one clears, an approval marks though its checks still run, an approved PR whose checks run again after a push marks nothing, and a conflict GitHub is still working out counts as what was known of it.
 * A PR seen for the first time is recorded and marks nothing, whatever it holds; one with no status keeps what was seen of it; an answer in which any request to GitHub failed changes nothing, and what it did learn waits for the next whole answer.
 * Before and now are both read with the approvals the repository needs now (`approvals`), so changing that number marks nothing by itself.
 * What is seen is kept by each PR's key (`prKey`), and a change names its PR as `prs` spells it.
 */
export function prChanges(seen: PrSeen | null, prs: readonly PrRef[], read: PrStatusRead, approvals: Approvals): { seen: PrSeen | null; changes: { pr: string; types: PrNeedsYouType[] }[] } {
  if (read.problem !== null) return { seen, changes: [] };
  const next: PrSeen = { ...seen };
  const changes: { pr: string; types: PrNeedsYouType[] }[] = [];
  for (const pr of prs) {
    const key = prKey(pr);
    const answered = read.statuses[key];
    if (answered === undefined) continue;
    const before = seen?.[key];
    const status = withKnownConflict(answered, before);
    next[key] = status;
    if (before === undefined) continue;
    const required = approvalsRequired(approvals, pr.repository);
    const known = withFieldsKnown(before, status);
    const was = conditionsOf(known, required);
    const now = conditionsOf(status, required);
    const isNew = (condition: PrNeedsYouType): boolean => !was.has(condition) || (condition === 'pr.changes-requested' && asksForChangesAnew(known, status));
    // Open again, everything it holds is news: a closed PR held none of it.
    const found = before.state === 'closed' && status.state === 'open' ? ranked(['pr.reopened', ...now]) : ranked([...now].filter(isNew));
    if (found.length > 0) changes.push({ pr: prReference(pr), types: found });
  }
  return { seen: seen === null && prs.every((pr) => read.statuses[prKey(pr)] === undefined) ? null : next, changes };
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
export function verdictOf(pr: PrRef, read: PrStatusRead, approvals: Approvals): PrVerdict {
  return prVerdict(knownStatus(pr, read), approvalsRequired(approvals, pr.repository));
}

/** A PR's status from main's answer, null while main could not ask GitHub, whatever it still holds from before. */
function knownStatus(pr: PrRef, read: PrStatusRead): PrStatus | null {
  return read.problem === null ? (read.statuses[prKey(pr)] ?? null) : null;
}

/** Whether a PR is merged or closed by main's answer, null for one open or not known to be either, read as its mark reads it (`knownStatus`). */
export function settledState(pr: PrRef, read: PrStatusRead): 'merged' | 'closed' | null {
  const status = knownStatus(pr, read);
  return status === null || status.state === 'open' ? null : status.state;
}

/** The approvals each repository needs, from the settings as they stand; none before they are read, so GitHub's decision alone says approved until then. */
export function approvalsIn(settings: SettingsView | null): Approvals {
  return settings?.approvals.value ?? {};
}

/** How your role on a PR reads, null for your own, which is most of them and so says nothing (decided 2026-11-06), or one not known. */
const ROLE_WORDS: Record<PrRole, string | null> = { own: null, reviewing: 'reviewing', other: 'someone else’s' };

/** An open PR's approvals: `1 of 2 approvals` where its repository needs a number, `1 approval` or `2 approvals` where not, and nothing for none without a number, or a count not known. */
function approvalWords(status: OpenStatus, required: number | null): string | null {
  const count = status.approvals;
  if (count === null) return null;
  if (required !== null) return `${count} of ${required} approvals`;
  if (count === 0) return null;
  return count === 1 ? '1 approval' : `${count} approvals`;
}

/** What a PR's menu item says after its reference, in order: your role where it is not yours, its state (`verdictOf`), and an open PR's approvals; nothing while main could not ask GitHub. */
export function prDetails(pr: PrRef, read: PrStatusRead, approvals: Approvals): string[] {
  const status = knownStatus(pr, read);
  if (status === null) return [];
  const required = approvalsRequired(approvals, pr.repository);
  const role = status.role === null ? null : ROLE_WORDS[status.role];
  const { words } = prVerdict(status, required);
  const counted = status.state === 'open' ? approvalWords(status, required) : null;
  return [role, words, counted].filter((part): part is string => part !== null);
}

/** The mark for `prs` from main's answer: their roll-up tone, and the PRs that set it counted by state, `1 with failing checks`; when main could not ask GitHub, `normal`, saying why. */
export function prMark(prs: readonly PrRef[], read: PrStatusRead, approvals: Approvals): PrMark {
  if (read.problem !== null) return { tone: 'normal', says: `no status: ${read.problem}` };
  const verdicts = prs.map((pr) => verdictOf(pr, read, approvals));
  const tone = rollUpPrTone(verdicts.map((verdict) => verdict.tone));
  const counts = new Map<PrWords, number>();
  for (const verdict of verdicts) if (verdict.tone === tone && verdict.words !== null) counts.set(verdict.words, (counts.get(verdict.words) ?? 0) + 1);
  return { tone, says: [...counts].map(([words, count]) => `${count} ${COUNTED[words]}`).join(', ') || null };
}
