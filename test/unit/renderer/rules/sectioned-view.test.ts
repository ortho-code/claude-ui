import { describe, expect, it } from 'vitest';
import { coreFields } from '../../../../src/shared/query/fields';
import type { SessionSummary } from '../../../../src/shared/types';
import { offeredBy, sectionsOf, type SectionedView } from '../../../../src/renderer/rules/sectioned-view';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';
import { ago, facts, only } from '../../shared/query/facts';
import { session as fixture } from '../fixtures';

const fields = coreFields(bundledNeedsYou());

const session = (id: string, days: number): SessionSummary => fixture({ id, title: id, lastActivity: ago(days) });

/** Pinned sessions first, newest first, then noted ones, oldest first, among those not set aside. */
const VIEW: SectionedView = {
  id: 'test',
  name: 'Test',
  shared: '-is:set-aside',
  sections: [
    { id: 'pinned', name: 'Pinned', query: 'is:pinned', sort: 'activity' },
    { id: 'noted', name: 'Noted', query: 'has:note', sort: 'activity-oldest' },
  ],
};

const given = facts({ pinned: only('pin-old', 'pin-new', 'both'), note: (s) => (['note-old', 'note-new', 'both', 'aside'].includes(s.id) ? 'a note' : undefined), setAside: (s) => (s.id === 'aside' ? { at: 0, due: null } : undefined) });
const sessions = [session('note-new', 1), session('pin-old', 9), session('both', 5), session('note-old', 8), session('aside', 3), session('pin-new', 2), session('neither', 4)];

describe('sectionsOf', () => {
  it('puts a session in the first section whose query holds, each section in its own order', () => {
    const shown = sectionsOf(VIEW, sessions, fields, given);
    expect(shown.map((section) => [section.id, section.rows.map((row) => row.id)])).toEqual([
      ['pinned', ['pin-new', 'both', 'pin-old']],
      ['noted', ['note-old', 'note-new']],
    ]);
  });

  it('keeps a section with no rows, so it can say why it is empty', () => {
    const shown = sectionsOf(VIEW, [session('neither', 1)], fields, given);
    expect(shown.map((section) => [section.id, section.rows.length])).toEqual([
      ['pinned', 0],
      ['noted', 0],
    ]);
  });

  it('throws on a query of its own that does not read, naming the view', () => {
    expect(() => sectionsOf({ ...VIEW, shared: 'nosuchfield:x' }, sessions, fields, given)).toThrow(/Test view's query "nosuchfield:x"/);
  });
});

describe('offeredBy', () => {
  it('holds every session that meets the shared query, those no section takes included', () => {
    expect(offeredBy(VIEW, sessions, fields, given).map((s) => s.id)).toEqual(['note-new', 'pin-old', 'both', 'note-old', 'pin-new', 'neither']);
  });
});
