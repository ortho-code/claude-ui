import { placeChildren } from '../../../ui/keyed';
import { entityKey } from '../../../rules/sessions';
import { store, type View } from '../../../state/app';
import { visibleSessions } from '../../../state/views';
import { whereOf } from './describe';
import type { DrawnRows, FlatSection } from './drawn';
import { createFlatSection } from './headings';
import { placeRows } from './placing';
import { drawRow, updateRow, type FlatLine, type RowView } from './rows';

/**
 * Rows drawn flat into `into`, in place of what it held: each section a heading over its rows where it has one, its rows `drawn`'s own, in the order given, each led by where it sits where the scope does not say it, then why it is there where its section says, else what the row says otherwise (`updateRow`).
 * A row a draw leaves out is kept off the page while its session is in the listing, so a draw that brings it back does not build it again.
 */
export function drawFlat(drawn: DrawnRows, into: HTMLElement, sections: readonly FlatSection[], view: RowView & View<'sessions' | 'activeProject' | 'projectNames' | 'groupState'>): void {
  drawn.dots.clear();
  drawn.tabMarks.clear();
  drawn.current.clear();
  for (const s of visibleSessions(view)) drawn.current.set(entityKey(s), s);
  const placed = sections.map((section) => {
    const els = drawn.flat.draw(section.id, () => createFlatSection(section.heading !== null));
    if (els.heading && section.heading) {
      els.heading.label.textContent = section.heading.name;
      els.heading.count.textContent = String(section.heading.count);
      els.heading.note.textContent = section.heading.note ?? '';
      els.heading.note.hidden = section.heading.note === null;
    }
    // Where it sits, worked out again at each tick from the store as it then is.
    const line: FlatLine = { lead: (shown) => whereOf(shown, store.get()) };
    const rows = section.rows.map((session) => {
      const row = drawRow(drawn, entityKey(session));
      updateRow(drawn, row, session, view, line);
      row.classList.remove('after-groups');
      return row;
    });
    placeRows(els.rows, rows);
    return els.section;
  });
  placeChildren(into, placed);
  drawn.flat.sweep();
  drawn.rows.sweep((key) => drawn.current.has(key));
}
