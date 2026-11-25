import { prReference } from '../sessions/prs';
import { categoryOf, type NeedsYouRegistry } from '../status/needs-you';
import type { SessionSummary } from '../types';
import { containsIgnoringCase } from './contains';
import type { QueryFacts } from './facts';
import { wordField, type Field, type FieldRegistry, type FieldValue, type WordSource } from './field';
import { atDay, dayOf, readMoment, type Day } from './moment';
import { PR_FIELDS } from './pr-fields';

const settled = (session: SessionSummary, facts: QueryFacts): boolean =>
  session.prs.length > 0 && session.prs.every((pr) => facts.prStates(pr).has('merged') || facts.prStates(pr).has('closed'));

const is = wordField('is', 'where a session stands', {
  working: { words: 'has a tab', holds: (s, f) => f.tabbed(s) },
  running: { words: 'claude runs in its tab', holds: (s, f) => f.running(s) },
  unfinished: { words: 'no tab, and not finished', holds: (s, f) => !f.tabbed(s) && !f.finished(s) && !f.deleting(s) },
  'set-aside': { words: 'set aside, with a day or whenever', holds: (s, f) => f.setAside(s) !== undefined },
  pinned: { words: 'pinned', holds: (s, f) => f.pinned(s) },
  worktree: { words: 'shows the worktree mark', holds: (s, f) => f.worktree(s) },
  gone: { words: 'cannot run, its folder is gone', holds: (s, f) => f.gone(s) },
  sibling: { words: 'shares its conversation with other sessions', holds: (s) => s.isSibling },
  'ready-to-finish': { words: 'links a PR, and every PR it links is merged or closed', holds: settled },
});

const has = wordField('has', 'what a session carries', {
  pr: { words: 'links a PR', holds: (s) => s.prs.length > 0 },
  note: { words: 'a note', holds: (s, f) => f.note(s) !== undefined },
});

const status = wordField('status', "what its claude is doing, while it runs", {
  busy: { words: 'working', holds: (s, f) => f.status(s) === 'busy' },
  waiting: { words: 'waiting for you', holds: (s, f) => f.status(s) === 'waiting' },
  ready: { words: 'at its prompt', holds: (s, f) => f.status(s) === 'ready' },
  background: { words: 'working in the background', holds: (s, f) => f.status(s) === 'background' },
});

/** `needs:`, a session that needs you: for any reason, a category's, or one type's, claude's own ask counted as its type. */
function needsField(registry: NeedsYouRegistry): Field {
  const values: FieldValue[] = [
    { value: 'any', words: 'any reason, read ones included' },
    ...registry.categories.map((category) => ({ value: category.id, words: category.label })),
    ...registry.types.map((type) => ({ value: type.id, words: type.label })),
  ];
  return {
    name: 'needs',
    words: 'needs you, by category or type',
    kind: 'word',
    values,
    holds(session, value, _comparison, facts) {
      const ask = facts.claudeAsks(session);
      const types: string[] = [...facts.reasons(session).map((reason) => reason.type), ...(ask === null ? [] : [ask])];
      if (value === 'any') return types.length > 0;
      return types.some((type) => type === value || categoryOf(registry, type) === value);
    },
  };
}

/** A field of free text that holds where the session's text contains the value, without regard to capitals. */
function textField(name: string, words: string, text: (session: SessionSummary, facts: QueryFacts) => string | undefined): Field {
  return {
    name,
    words,
    kind: 'text',
    holds: (session, value, _comparison, facts) => {
      const own = text(session, facts);
      return own !== undefined && containsIgnoringCase(own, value);
    },
  };
}

/**
 * A field of a moment the session has, holding as the comparison says; a session without that moment holds none.
 * The day a value names is worked out again only when the value or `now` differs from the last asked, so once per evaluation for a field named with one value.
 */
function momentField(name: string, words: string, at: (session: SessionSummary, facts: QueryFacts) => number | null | undefined): Field {
  let last: { value: string; now: number; day: Day | null } | null = null;
  return {
    name,
    words,
    kind: 'moment',
    holds(session, value, comparison, facts) {
      if (last?.value !== value || last.now !== facts.now) {
        const moment = readMoment(value);
        last = { value, now: facts.now, day: moment === null ? null : dayOf(moment, facts.now) };
      }
      const time = at(session, facts);
      return last.day !== null && time !== null && time !== undefined && atDay(time, comparison, last.day);
    },
  };
}

/** The texts free words search, each word in one of them. */
const WORDS: readonly WordSource[] = [
  { id: 'title', texts: (s) => [s.title] },
  { id: 'first-prompt', texts: (s) => [s.firstMessage] },
  { id: 'folder', texts: (s) => [s.cwd] },
  { id: 'id', texts: (s) => [s.id] },
  { id: 'note', texts: (s, f) => [f.note(s) ?? ''] },
  { id: 'group', texts: (s, f) => [f.groupName(s) ?? ''] },
  { id: 'pr', texts: (s, f) => s.prs.map((pr) => `${prReference(pr)} ${f.prTitle(pr) ?? ''}`) },
];

/** Every field the app has, the needs-you categories and types as they stand among `needs:`'s values. */
export function coreFields(needsYou: NeedsYouRegistry): FieldRegistry {
  const fields: Field[] = [
    is,
    has,
    status,
    needsField(needsYou),
    textField('project', "its project's name", (s, f) => f.projectName(s)),
    textField('group', "its group's name", (s, f) => f.groupName(s)),
    textField('title', 'its title', (s) => s.title),
    momentField('active', 'when it was last active', (s) => Date.parse(s.lastActivity)),
    momentField('kept', 'when Keep last kept it out of the review', (s, f) => f.kept(s)),
    momentField('due', 'when it comes back from being set aside', (s, f) => f.setAside(s)?.due),
    ...PR_FIELDS,
  ];
  return { fields: new Map(fields.map((field) => [field.name, field])), words: WORDS };
}
