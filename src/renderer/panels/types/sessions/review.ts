import { fromMarkup } from '../../../ui/dom';
import { REVIEW, reviewCount, reviewSections, type ReviewSection } from '../../../rules/review';
import { store, type View } from '../../../state/app';
import { queryFacts, queryFields, type QueryView } from '../../../state/query-facts';
import { endBulk, startReview } from '../../../state/bulk';
import { visibleSessions } from '../../../state/views';
import { unavailable, setUnavailable } from '../../../ui/unavailable';
import type { FlatSection } from './drawn';
import './review.css';

/**
 * THE REVIEW, drawn (docs/architecture/session-list.md § The review): the Review button with its count on the row under the sidebar's header, and what the list needs to draw the review's sets flat in place of its projects (list.ts).
 * Which sessions it offers and why is the pure module's (`review.ts`); this reads the store for it.
 */

/** The Review button, which the row under the header holds at its right end (arrangement.ts). */
export const reviewButton = fromMarkup(`<button id="review-button" type="button" aria-pressed="false">${REVIEW.name} <span class="review-count"></span></button>`, HTMLButtonElement);
const button = reviewButton;
const count = reviewButton.querySelector<HTMLElement>('.review-count')!;

/** What the review reads of the store. */
export type ReviewView = QueryView & View<'sessions' | 'activeProject' | 'needsYouTypes'>;

/** The review in the switcher's scope, as of `now`: the project on show, or every project in All. */
export function reviewInScope(view: ReviewView, now = Date.now()): ReviewSection[] {
  const sessions = visibleSessions(view).filter((s) => view.activeProject === null || s.repoRoot === view.activeProject);
  // PR status is on until the settings are read, as it is by default; nothing has been asked by then, so Ready to finish's line says it is asking.
  return reviewSections(sessions, queryFields(view), queryFacts(view, now), { prStatus: view.prStatus, prStatusOn: view.settings?.prStatus.value ?? true });
}

/** The review's sets as the list draws them flat (list.ts), each under its heading. */
export function reviewFlat(sections: readonly ReviewSection[]): FlatSection[] {
  return sections.map((set) => ({ id: set.id, heading: { name: set.name, count: set.rows.length, note: set.note }, rows: set.rows, lines: set.lines }));
}

/** The Review button follows the review in scope: its count, unavailable at none while the list does not show it, since a review with nothing in it would end at once; pressed, and a press that ends it, while the list shows it. */
function showReviewButton(view: ReviewView & View<'reviewing'>): void {
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

/** The longest the count waits between looks: a session crosses its days with nothing in the store moving, as a set-aside mark comes due (state/set-aside.ts); an open review is looked at every minute with the list's order (list.ts). */
const REVIEW_LOOK_EVERY_MS =60 * 60 * 1000;

/** The button's count, now and as the store and the clock move; registered with the sidebar's repaints (watch.ts). */
export function watchReviewButton(): void {
  const slices = ['sessions', 'tabs', 'finished', 'pendingDeletes', 'setAside', 'kept', 'prStatus', 'settings', 'activeProject', 'reviewing', 'needsYouTypes'] as const;
  // Once a frame: it counts the review over every session, and draws the whole button from the store as it is, so nothing it skips is lost.
  // The slices are what the review's own queries read; the count reads the whole store, since the query facts answer for every field.
  store.watch(slices, () => showReviewButton(store.get()), { frame: true });
  window.setInterval(() => showReviewButton(store.get()), REVIEW_LOOK_EVERY_MS);
  showReviewButton(store.get());
  let wasReviewing = store.get().reviewing;
  store.watch(slices, () => {
    const view = store.get();
    if (view.reviewing === wasReviewing) return;
    wasReviewing = view.reviewing;
    window.claudeUi.recordReview(view.reviewing ? 'start' : 'end', view.activeProject === null ? 'all' : 'project', reviewCount(reviewInScope(view)));
  });
}
