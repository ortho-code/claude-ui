import { element } from '../../../dom';
import { store, type Arrangement, type View } from '../../../state/app';
import { setUnavailable, unavailable } from '../../../unavailable';
import type { PanelHost, PanelView } from '../../contract';
import { viewButton } from '../../view-switch';
import { hostOf } from '../builtin';
import { reviewButton } from './review';
import './arrangement.css';

/**
 * THE LIST'S ARRANGEMENT (docs/architecture.md § Recent): Grouped, by project and group, or Recent, flat and last worked on first, as the sessions panel's two views, switched on the row under the sidebar's header, which holds the Review button, the filter's toggle and collapse-all at its other end.
 * The pick is the panel's, kept as any panel's picked view is (`PanelHost.pickView`), with its layout entry's `view` where it starts; the store's `arrangement` follows it, for the list to draw from.
 */

/** The sessions panel's views, in the order the switch shows them; the first is what a panel with no pick and no `view` in its entry shows. */
export const SESSION_VIEWS: PanelView[] = [
  { id: 'grouped', label: 'Grouped', icon: 'tree' },
  { id: 'recent', label: 'Recent', icon: 'clock' },
];

/** The view picked, as an arrangement: Recent only when that is what is picked, so a `view` the panel does not offer shows the first, as its group's note line says (tree.ts). */
const arrangementOf = (view: string | null): Arrangement => (view === 'recent' ? 'recent' : 'grouped');

const views = element('span', 'panel-views');
/** The right end of the row under the header: the Review button, then what the sidebar places after it (index.ts). */
export const listRowEnd = element('div', 'list-row-end');
listRowEnd.append(reviewButton);
/** The row under the header: the switch on the left, the Review button and the list's own buttons, the filter's and collapse-all, at the right end. */
export const listRow = element('div');
listRow.id = 'list-row';
listRow.append(views, listRowEnd);

/** What the sessions panel's every mount, and every change of its pick without one, tells and reads of its host: the views it offers, so an entry naming another is said, and the one picked, which the list then shows. */
export function arrangementMounted(host: PanelHost): void {
  host.setViews(SESSION_VIEWS);
  store.set({ arrangement: arrangementOf(host.view()) });
}

/** The switch follows the arrangement, and while the review is open it is unavailable, since the review is drawn in its own order over whichever is picked; drawn again only when what it says changes. */
let said = '';
function showArrangement(view: View<'arrangement' | 'reviewing'>): void {
  const now = `${view.arrangement} ${view.reviewing}`;
  if (now === said) return;
  said = now;
  views.replaceChildren(
    ...SESSION_VIEWS.map((option) => {
      const button = viewButton(
        option,
        option.id === view.arrangement,
        () => {
          if (unavailable(button)) return;
          const arrangement = arrangementOf(option.id);
          hostOf('sessions').pickView(arrangement);
          store.set({ arrangement });
        },
        true,
      );
      if (view.reviewing) setUnavailable(button, 'The review keeps its own order', option.label);
      return button;
    }),
  );
}

/** The switch, now and as the arrangement and the review change; registered with the sidebar's repaints (watch.ts). */
export function watchArrangement(): void {
  store.watch(['arrangement', 'reviewing'], showArrangement);
  showArrangement(store.get());
}
