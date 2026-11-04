import type { SessionSummary } from '../../../../shared/types';
import { fromMarkup } from '../../../dom';
import { entityKey } from '../../../logic';
import { REVIEW, reviewCount, reviewSections, type ReviewFacts, type ReviewSection } from '../../../review';
import { store, type View } from '../../../state/app';
import { endBulk, startReview } from '../../../state/bulk';
import { groupNameOf, projName, visibleSessions } from '../../../state/views';
import { unavailable, setUnavailable } from '../../../unavailable';
import './review.css';

/**
 * THE REVIEW, drawn (docs/architecture.md § The review): the Review button with its count on the row under the sidebar's header, and what the list needs to draw the review's sets in place of its projects (list.ts) — the sets in scope, and each row's line saying why it is there.
 * Which sessions it offers and why is the pure module's (`review.ts`); this reads the store for it.
 */

export const reviewRow = fromMarkup(`
  <div id="review-row">
    <button id="review-button" type="button" aria-pressed="false">${REVIEW.name} <span class="review-count"></span></button>
  </div>`);
const button = reviewRow.querySelector<HTMLButtonElement>('#review-button')!;
const count = reviewRow.querySelector<HTMLElement>('.review-count')!;

/** What the review reads of the store. */
export type ReviewView = View<'sessions' | 'tabs' | 'archived' | 'pendingDeletes' | 'later' | 'kept' | 'notes' | 'prStatus' | 'settings' | 'activeProject'>;

/** The store's state as the review's terms read it (`ReviewFacts`). */
export function reviewFacts(view: ReviewView): ReviewFacts {
  return {
    tabbed: new Set(view.tabs.map((t) => entityKey(t.session))),
    archived: view.archived,
    pendingDeletes: view.pendingDeletes,
    later: view.later,
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

/** Where a row of the review sits, where the scope does not say it: its project in All, and its group, ahead of why it is there. */
export function whereOf(session: SessionSummary, view: View<'activeProject' | 'projectNames' | 'groupState'>): string | null {
  const group = groupNameOf(session, view);
  const parts = [...(view.activeProject === null ? [projName(session.repoRoot, view)] : []), ...(group ? [group] : [])];
  return parts.length > 0 ? parts.join(' › ') : null;
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

/** The longest the count, and an open review (list.ts), wait between looks: a session crosses its days with nothing in the store moving, as a later mark comes due (state/later.ts). */
export const REVIEW_LOOK_EVERY_MS = 60 * 60 * 1000;

/** The button's count, now and as the store and the clock move; registered with the sidebar's repaints (watch.ts). */
export function watchReviewButton(): void {
  const slices = ['sessions', 'tabs', 'archived', 'pendingDeletes', 'later', 'kept', 'notes', 'prStatus', 'settings', 'activeProject', 'reviewing'] as const;
  store.watch(slices, showReviewButton);
  window.setInterval(() => showReviewButton(store.get()), REVIEW_LOOK_EVERY_MS);
  showReviewButton(store.get());
}
