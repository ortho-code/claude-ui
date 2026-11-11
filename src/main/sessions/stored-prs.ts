import type { PrRole, PrSeen, PrStatus, SessionPr } from '../../shared/types';
import { PR_ROLES, prFromUrl, referenceKey } from '../../shared/sessions/prs';

/** What may stand in each part of an open PR's status, null among them (`PrStatus`). */
const PR_PARTS: Record<'review' | 'checks' | 'conflict', readonly unknown[]> = {
  review: ['approved', 'changes-requested', 'review-required', null],
  checks: ['passed', 'failed', 'running', null],
  conflict: [true, false, null],
};

/** A field a build before it did not store, read as null: not known. */
const unknownIfMissing = (value: unknown): unknown => (value === undefined ? null : value);

/** Whether a stored value is a field's value or null, by the check for its value. */
const valueOrNull = (value: unknown, check: (value: unknown) => boolean): boolean => value === null || check(value);

/**
 * A PR's status as it was stored, null for one this build cannot read.
 * A field a build before it did not store is read as not known, so a status kept then still reads.
 */
function prStatusOf(raw: unknown): PrStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  const { state, draft, review, checks, conflict } = fields;
  const [role, approvals, newCommits, reviewAsked, changesRequested] = [fields.role, fields.approvals, fields.newCommits, fields.reviewAsked, fields.changesRequested].map(unknownIfMissing);
  if (!valueOrNull(role, (value) => PR_ROLES.includes(value as PrRole))) return null;
  if (state === 'merged' || state === 'closed') return { state, role: role as PrRole | null };
  if (state !== 'open' || typeof draft !== 'boolean' || !PR_PARTS.review.includes(review) || !PR_PARTS.checks.includes(checks) || !PR_PARTS.conflict.includes(conflict)) return null;
  const counts = valueOrNull(approvals, (value) => Number.isInteger(value) && (value as number) >= 0);
  const flags = [newCommits, reviewAsked].every((flag) => valueOrNull(flag, (value) => typeof value === 'boolean'));
  const ids = valueOrNull(changesRequested, (value) => Array.isArray(value) && value.every((id) => typeof id === 'string'));
  if (!counts || !flags || !ids) return null;
  return { state, role, draft, review, checks, conflict, approvals, newCommits, reviewAsked, changesRequested } as PrStatus;
}

/** The stored PR links, each read back from its page (`prFromUrl`), so one whose address is not shaped like a GitHub pull request page is dropped, and a session left with none with it. */
export function prLinksOf(raw: unknown): Record<string, SessionPr[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const links: Record<string, SessionPr[]> = {};
  for (const [id, list] of Object.entries(raw)) {
    const prs = (Array.isArray(list) ? (list as unknown[]) : []).flatMap((each) => {
      const url = typeof each === 'object' && each !== null ? (each as { url?: unknown }).url : undefined;
      const pr = typeof url === 'string' ? prFromUrl(url) : null;
      return pr ? [pr] : [];
    });
    if (prs.length > 0) links[id] = prs;
  }
  return links;
}

/**
 * What was last seen of the PRs, from whatever was stored: null for none at all, and an entry this build cannot read dropped.
 * Each is read under its key (`referenceKey`), as the window keeps them, so one an earlier build kept under each of two spellings is read once, the first kept.
 */
export function prSeenOf(raw: unknown): PrSeen | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const seen: PrSeen = {};
  for (const [ref, entry] of Object.entries(raw as Record<string, unknown>)) {
    const status = prStatusOf(entry);
    const key = referenceKey(ref);
    if (status && !Object.hasOwn(seen, key)) seen[key] = status;
  }
  return seen;
}
