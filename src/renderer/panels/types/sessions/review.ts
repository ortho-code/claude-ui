import type { SessionSummary } from '../../../../shared/types';
import { fromMarkup } from '../../../dom';
import { entityKey } from '../../../logic';
import { REVIEW, reviewCount, reviewSections, type ReviewFacts, type ReviewSection } from '../../../review';
import { store, type View } from '../../../state/app';
import { endBulk, startReview } from '../../../state/bulk';
import { visibleSessions } from '../../../state/views';
import { unavailable, setUnavailable } from '../../../unavailable';
import type { FlatSection } from './drawn';
import './review.css';

/**
 * THE REVIEW, drawn (docs/architecture.md § The review): the Review button with its count on the row under the sidebar's header, and what the list needs to draw the review's sets flat in place of its projects (list.ts) — the sets in scope, and each row's line saying why it is there.
 * Which sessions it offers and why is the pure module's (`review.ts`); this reads the store for it.
 */

/** The Review button, which the row under the header holds at its right end (arrangement.ts). */
export const reviewButton = fromMarkup(`<button id="review-button" type="button" aria-pressed="false">${REVIEW.name} <span class="review-count"></span></button>`, HTMLButtonElement);
const button = reviewButton;
const count = reviewButton.querySelector<HTMLElement>('.review-count')!;

/** What the review reads of the store. */
export type ReviewView = View<'sessions' | 'tabs' | 'archived' | 'pendingDeletes' | 'setAside' | 'kept' | 'notes' | 'prStatus' | 'settings' | 'activeProject'>;

/** The store's state as the review's terms read it (`ReviewFacts`). */
export function reviewFacts(view: ReviewView): ReviewFacts {
  return {
    tabbed: new Set(view.tabs.map((t) => entityKey(t.session))),
    archived: view.archived,
    pendingDeletes: view.pendingDeletes,
    setAside: view.setAside,
    kept: view.kept,
    notes: view.notes,
    prStatus: view.prStatus,
    // On until the settings are read, as it is by default; nothing has been asked by then, so its line says it is asking.
    prStatusOn: view.settings?.prStatus.value ?? true,
  };
}

/** The review in the switcher's scope, as of `now`: the project on show, or every project in All. */
export function reviewInScope(view: ReviewView, now = Date.now()): ReviewSection[] {
  const sessions = visibleSessions(view).filter((s) => view.activeProject === null || s.repoRoot === view.activeProject);
  return reviewSections(sessions, reviewFacts(view), now);
}

/** The review's sets as the list draws them flat (list.ts): each under its heading, each row's line saying why it is there, worked out again at each tick from the store as it then is. */
export function reviewFlat(sections: readonly ReviewSection[]): FlatSection[] {
  return sections.map((set) => {
    const rule = REVIEW.sets.find((s) => s.id === set.id)!;
    return {
      id: set.id,
      heading: { name: set.name, count: set.rows.length, note: set.note },
      rows: set.rows.map(({ session }) => session),
      why: (shown: SessionSummary) => rule.why(shown, reviewFacts(store.get()), Date.now()),
    };
  });
}

/** The Review button follows the review in scope: its count, unavailable at none while the list does not show it, since a review with nothing in it would end at once; pressed, and a press that ends it, while the list shows it. */
export function showReviewButton(view: ReviewView & View<'reviewing'>): void {
  const n = reviewCount(reviewInScope(view));
  count.textContent = n > 0 ? String(n) : '';
  setUnavailable(button, n === 0 && !view.reviewing ? 'Nothing to review' : null, `${n} ${n === 1 ? 'session' : 'sessions'} to decide: ready to finish, or untouched for long`);
  button.setAttribute('aria-pressed', String(view.reviewing));
  button.classList.toggle('active', view.reviewing);
  document.getElementById('sidebar')?.classList.toggle('reviewing', view.reviewing);
}

button.addEventListener('click', () => {
  if (unavailable(button)) return;
  if (store.get().reviewing) endBulk();
  else startReview();
});

/** The longest the count waits between looks: a session crosses its days with nothing in the store moving, as a set-aside mark comes due (state/setaside.ts); an open review is looked at every minute with the list's order (list.ts). */
export const REVIEW_LOOK_EVERY_MS = 60 * 60 * 1000;

/** The button's count, now and as the store and the clock move; registered with the sidebar's repaints (watch.ts). */
export function watchReviewButton(): void {
  const slices = ['sessions', 'tabs', 'archived', 'pendingDeletes', 'setAside', 'kept', 'notes', 'prStatus', 'settings', 'activeProject', 'reviewing'] as const;
  store.watch(slices, showReviewButton);
  window.setInterval(() => showReviewButton(store.get()), REVIEW_LOOK_EVERY_MS);
  showReviewButton(store.get());
}
