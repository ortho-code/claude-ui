import { PR_ROLES, prKey, prOfReference } from '../sessions/prs';
import type { PrState } from './facts';
import { wordField, type Field } from './field';

const REFERENCE = /^[\w.-]+\/[\w.-]+#\d+$/;
const NUMBER = /^\d+$/;

const ROLE_WORDS: Readonly<Record<(typeof PR_ROLES)[number], string>> = {
  own: 'a PR you wrote',
  reviewing: 'a PR you review or are asked to',
  other: 'a PR someone else wrote, not yours to review',
};

/** `pr:`, a session that links a PR: by your role on it, its number, or `owner/repo#n` without regard to the repository's capitals. */
const pr: Field = {
  name: 'pr',
  words: 'links a PR: by your role on it, its number, or owner/repo#number',
  kind: 'word',
  values: PR_ROLES.map((role) => ({ value: role, words: ROLE_WORDS[role] })),
  accepts: (value) => NUMBER.test(value) || REFERENCE.test(value),
  holds(session, value, _comparison, facts) {
    const wanted = value.toLowerCase();
    if (NUMBER.test(value)) return session.prs.some((each) => each.number === Number(value));
    if (REFERENCE.test(value)) return session.prs.some((each) => prKey(each) === prKey(prOfReference(value)));
    return session.prs.some((each) => facts.prRole(each) === wanted);
  },
};

const STATE_WORDS: Readonly<Record<PrState, string>> = {
  open: 'open',
  draft: 'open as a draft',
  merged: 'merged',
  closed: 'closed without merging',
  'changes-requested': 'a reviewer asks for changes',
  approved: 'approved, by as many as its repository needs',
  'checks-failed': 'its checks failed',
  'checks-running': 'its checks still run',
  conflict: 'it conflicts with its base',
};

/** `pr.state:`, a session that links a PR in that state, as GitHub says it. */
const prState: Field = wordField(
  'pr.state',
  'links a PR in that state',
  Object.fromEntries(
    (Object.keys(STATE_WORDS) as PrState[]).map((state) => [state, { words: STATE_WORDS[state], holds: (session, facts) => session.prs.some((each) => facts.prStates(each).has(state)) }]),
  ),
);

/** GitHub's fields, bundled: what a PR's forge says of it. */
export const PR_FIELDS: readonly Field[] = [pr, prState];
