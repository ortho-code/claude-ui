import { approvalsRequired, authorName, prKey, prReference, type Approvals } from '../../shared/sessions/prs';
import { firesFor, PR_TYPES, type NeedsYouRegistry } from '../../shared/status/needs-you';
import type { SettingsView } from '../../shared/config/settings';
import type { PrNames, PrNeedsYouType, PrRef, PrRole, PrSeen, PrStatus, PrStatusRead, PrToFind, SessionSummary } from '../../shared/types';
import type { View } from '../state/app';
import type { Tone } from '../ui/tone';
import { lookClass } from './looks';

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

/** How long after the command a PR opened in the browser is looked for: long enough for one submitted whenever you get to it, and bounded, so a create left unsubmitted is not asked about for ever. */
export const FIND_FOR_MS = 30 * 24 * 60 * MINUTE;

/** What tells one PR opened in the browser from another: its session, repository, branch and when the command ran. */
export const createKey = (create: PrToFind): string => [create.id, create.repository.toLowerCase(), create.head, create.at].join('\n');

/** The PRs sessions opened in the browser that are still looked for at `now`: within `FIND_FOR_MS` of the command, and not found yet (`found`, by `createKey`). */
export function createsToFind(sessions: readonly Pick<SessionSummary, 'id' | 'webCreates'>[], found: ReadonlySet<string>, now: number): PrToFind[] {
  return sessions.flatMap(({ id, webCreates }) => webCreates.map((create) => ({ ...create, id }))).filter((create) => now - Date.parse(create.at) < FIND_FOR_MS && !found.has(createKey(create)));
}

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
export type PrWords = 'checks failed' | 'merge conflict' | 'changes requested' | 'draft' | 'checks running' | 'review required' | 'approved' | 'new commits since your review' | 'your review asked' | 'open' | 'merged' | 'closed';

/**
 * The ink a PR's mark takes: a tone (tone.ts), or `again`, a PR that is yours to review again, which takes the look of the needs-you type that says so (`PrVerdict.look`), as the needs-you mark of that type does.
 */
export type PrInk = Tone | 'again';

/** Every ink, for a surface that toggles their classes. */
export const PR_INKS: readonly PrInk[] = ['normal', 'attention', 'positive', 'muted', 'danger', 'again'];

/** Who a PR waits on, where its strongest state is someone else's to act on. */
export type PrWaitsOn = 'the author' | 'the reviewers';

/**
 * A PR's standing: the ink its mark takes, the words for why, null where its status is not known, the needs-you type whose look inks an `again` PR, and who the PR waits on where its strongest state is not yours to act on.
 */
export interface PrVerdict {
  tone: PrInk;
  words: PrWords | null;
  look: PrNeedsYouType | null;
  waitsOn: PrWaitsOn | null;
}

/** One state a PR's status holds, in the order its words are chosen: the needs-you type that says it is yours to act on, null for one no type marks, and the ink it gives where it is. */
interface Rung {
  type: PrNeedsYouType | null;
  tone: PrInk;
  words: PrWords;
}

/** Whether a PR type fires for your role on the PR its verdict is for (`firesFor`): what decides whose turn a state is. */
export type Fires = (type: PrNeedsYouType) => boolean;

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
 * Every state an open PR's status holds, strongest first:
 * - `danger`: its checks failed, or it conflicts with its base;
 * - `attention`: changes were requested;
 * - `normal`: a draft, running checks, a review required or approved by fewer than the repository's number;
 * - `positive`: approved (`isApproved`), not a draft, its checks passed or it has none, and no conflict — ready to merge; approved with a conflict GitHub has not worked out yet is `normal`;
 * - `again`: commits since your review, or your review asked;
 * - `normal`: open, when it holds none of the rest.
 */
function rungsOf(status: OpenStatus, required: number | null): Rung[] {
  const rungs: Rung[] = [];
  if (status.checks === 'failed') rungs.push({ type: 'pr.checks-failed', tone: 'danger', words: 'checks failed' });
  if (status.conflict === true) rungs.push({ type: 'pr.conflict', tone: 'danger', words: 'merge conflict' });
  if (status.review === 'changes-requested') rungs.push({ type: 'pr.changes-requested', tone: 'attention', words: 'changes requested' });
  if (status.draft) rungs.push({ type: null, tone: 'normal', words: 'draft' });
  if (status.checks === 'running') rungs.push({ type: null, tone: 'normal', words: 'checks running' });
  if (status.review === 'review-required' || (status.review === 'approved' && !isApproved(status, required))) rungs.push({ type: null, tone: 'normal', words: 'review required' });
  else if (status.review === 'approved') {
    const ready = status.conflict === false && !status.draft && status.checks !== 'running' && status.checks !== 'failed';
    rungs.push(ready ? { type: 'pr.approved', tone: 'positive', words: 'approved' } : { type: null, tone: 'normal', words: 'approved' });
  }
  if (status.newCommits === true) rungs.push({ type: 'pr.new-commits', tone: 'again', words: 'new commits since your review' });
  if (status.reviewAsked === true) rungs.push({ type: 'pr.review-requested', tone: 'again', words: 'your review asked' });
  if (rungs.length === 0) rungs.push({ type: null, tone: 'normal', words: 'open' });
  return rungs;
}

/**
 * How a PR's status colours its mark: by whose turn it is (decided 2026-11-11).
 * A state colours it only where its needs-you type fires for your role on the PR (`fires`), the same rule that decides whether that state marks a session as needing you, so a conflict on someone else's PR leaves it plain and commits since your review on one you review colour it.
 * The PR takes the ink of the strongest state that is yours (`rungsOf`), and its words; with none, it is `normal`, its words the strongest state's, and where that state is someone else's to act on and your role is known, who it waits on: the author on someone else's PR, the reviewers on yours.
 * Merged or closed is `muted`; a PR whose status is not known is `normal`, which sets no colour of its own.
 * `required` is the approvals the PR's repository needs, null for GitHub's decision alone.
 */
export function prVerdict(status: PrStatus | null, required: number | null, fires: Fires): PrVerdict {
  if (status === null) return { tone: 'normal', words: null, look: null, waitsOn: null };
  if (status.state !== 'open') return { tone: 'muted', words: status.state, look: null, waitsOn: null };
  const rungs = rungsOf(status, required);
  const yours = rungs.find((rung) => rung.type !== null && fires(rung.type));
  if (yours) return { tone: yours.tone, words: yours.words, look: yours.tone === 'again' ? yours.type : null, waitsOn: null };
  const [strongest] = rungs as [Rung, ...Rung[]];
  const waitsOn = strongest.type !== null && status.role !== null ? (status.role === 'own' ? 'the reviewers' : 'the author') : null;
  return { tone: 'normal', words: strongest.words, look: null, waitsOn };
}

/** Whether a PR type fires for `role` by the needs-you types as they stand (`firesFor`). */
export function firesForRole(registry: NeedsYouRegistry, role: PrRole | null): Fires {
  return (type) => firesFor(registry, type, role);
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
function ranked(types: Iterable<PrNeedsYouType>): PrNeedsYouType[] {
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

/** The order a session's PRs roll up by, highest first: whatever most needs a person wins, in the needs-you categories' order, so the mark is muted only once every PR is merged or closed. */
const PR_TONE_ORDER: readonly PrInk[] = ['danger', 'attention', 'positive', 'again', 'normal', 'muted'];

/** The ink that speaks for several PRs, by `PR_TONE_ORDER`; `normal` for none. */
export function rollUpPrTone(tones: Iterable<PrInk>): PrInk {
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
  'new commits since your review': 'with new commits since your review',
  'your review asked': 'with your review asked',
  open: 'open',
  merged: 'merged',
  closed: 'closed',
};

/** What a session's PR mark shows: the ink its PRs roll up to, the look of an `again` one, and what set it or why there is no status, null with nothing to say. */
export interface PrMark {
  tone: PrInk;
  look: PrNeedsYouType | null;
  says: string | null;
}

/** What a PR's verdict is judged by beyond its status: the approvals each repository needs, and the needs-you types, whose roles say whose turn a state is. */
export interface PrRules {
  approvals: Approvals;
  registry: NeedsYouRegistry;
}

/** The rules as the settings and the needs-you types stand (`approvalsIn`). */
export function prRulesIn(view: View<'settings' | 'needsYouTypes'>): PrRules {
  return { approvals: approvalsIn(view.settings), registry: view.needsYouTypes };
}

/**
 * A PR's verdict from main's answer: as if it had no status while main could not ask GitHub, whatever status it still holds from before, so a status that may be stale never colours anything.
 * What the mark and a PR's menu item both take it from.
 */
export function verdictOf(pr: PrRef, read: PrStatusRead, rules: PrRules): PrVerdict {
  const status = knownStatus(pr, read);
  return prVerdict(status, approvalsRequired(rules.approvals, pr.repository), firesForRole(rules.registry, status?.role ?? null));
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

/** `names` with what each of `statuses` says a PR is called and who opened it, by its key, where it says so. */
export function withNames(names: ReadonlyMap<string, PrNames>, statuses: Readonly<Record<string, PrStatus>>): Map<string, PrNames> {
  const next = new Map(names);
  for (const [key, { title, author }] of Object.entries(statuses)) {
    if (title === undefined && author === undefined) continue;
    next.set(key, { ...next.get(key), ...(title === undefined ? {} : { title }), ...(author === undefined ? {} : { author }) });
  }
  return next;
}

/** How your role on a PR reads, null for your own, which is most of them and so says nothing (decided 2026-11-06), or one not known. */
const ROLE_WORDS: Record<PrRole, string | null> = { own: null, reviewing: 'reviewing', other: 'someone else’s' };

/**
 * Who a PR is by and your role on it, as its menu item says them: "by Jan Jansen · reviewing", or "by Jan Jansen" for someone else's, where its author is known; your own says nothing.
 * Without a known author, the role alone (`ROLE_WORDS`).
 */
function ownerWords(status: PrStatus): string[] {
  if (status.role === null || status.role === 'own') return [];
  if (status.author === undefined) return [ROLE_WORDS[status.role]].filter((words): words is string => words !== null);
  return [`by ${authorName(status.author)}`, ...(status.role === 'reviewing' ? ['reviewing'] : [])];
}

/** An open PR's approvals: `1 of 2 approvals` where its repository needs a number, `1 approval` or `2 approvals` where not, and nothing for none without a number, or a count not known. */
function approvalWords(status: OpenStatus, required: number | null): string | null {
  const count = status.approvals;
  if (count === null) return null;
  if (required !== null) return `${count} of ${required} approvals`;
  if (count === 0) return null;
  return count === 1 ? '1 approval' : `${count} approvals`;
}

/**
 * What a PR's menu item says under its name, in order: who it is by and your role where it is not yours (`ownerWords`), its state (`verdictOf`) with when a merged or closed one settled, who it waits on where that state is not yours to act on, an open PR's approvals, and since when an open one is open; nothing while main could not ask GitHub.
 * `moment` writes a date, as the window writes every moment in full (`momentInLanguage`).
 */
export function prDetails(pr: PrRef, read: PrStatusRead, rules: PrRules, moment: (at: number) => string): string[] {
  const status = knownStatus(pr, read);
  if (status === null) return [];
  const { words, waitsOn } = verdictOf(pr, read, rules);
  const counted = status.state === 'open' ? approvalWords(status, approvalsRequired(rules.approvals, pr.repository)) : null;
  const settled = status.state !== 'open' && status.settledAt !== undefined && words !== null ? `${words} ${moment(Date.parse(status.settledAt))}` : words;
  const since = status.state === 'open' && status.openedAt !== undefined ? `open since ${moment(Date.parse(status.openedAt))}` : null;
  return [...ownerWords(status), settled, waitsOn && `waiting on ${waitsOn}`, counted, since].filter((part): part is string => part !== null);
}

/** How a count of PRs reads in a mark's tooltip: by who it waits on where its state is not yours to act on, `1 waiting on the author`, otherwise by its state (`COUNTED`). */
function countedAs(verdict: PrVerdict): string | null {
  if (verdict.waitsOn !== null) return `waiting on ${verdict.waitsOn}`;
  return verdict.words === null ? null : COUNTED[verdict.words];
}

/**
 * The mark for `prs` from main's answer: their roll-up ink, with the look of the first `again` PR where that is the ink, and the PRs that set it counted by what they say (`countedAs`), `1 with failing checks`; when main could not ask GitHub, `normal`, saying why.
 */
export function prMark(prs: readonly PrRef[], read: PrStatusRead, rules: PrRules): PrMark {
  if (read.problem !== null) return { tone: 'normal', look: null, says: `no status: ${read.problem}` };
  const verdicts = prs.map((pr) => verdictOf(pr, read, rules));
  const tone = rollUpPrTone(verdicts.map((verdict) => verdict.tone));
  const setting = verdicts.filter((verdict) => verdict.tone === tone);
  const counts = new Map<string, number>();
  for (const verdict of setting) {
    const as = countedAs(verdict);
    if (as !== null) counts.set(as, (counts.get(as) ?? 0) + 1);
  }
  return { tone, look: setting.find((verdict) => verdict.look !== null)?.look ?? null, says: [...counts].map(([as, count]) => `${count} ${as}`).join(', ') || null };
}

/** The classes that ink a PR's mark or dot: its ink's, and for `again` the look's class (looks.ts), whose colour `pr-status.css` takes. */
export function inkClasses(ink: { tone: PrInk; look: PrNeedsYouType | null }): string[] {
  return [`tone-${ink.tone}`, ...(ink.tone === 'again' && ink.look !== null ? [lookClass(ink.look)] : [])];
}
