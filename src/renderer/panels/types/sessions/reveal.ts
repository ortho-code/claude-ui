import type { SessionSummary } from '../../../../shared/types';
import { flash } from '../../../flash';
import { entityKey } from '../../../logic';
import { store } from '../../../state/app';
import { container, currentByKey, groupSections, projectSections, sessionRows } from './drawn';
import { unfold } from './folding';

/**
 * BRINGING SOMETHING IN THE SESSION LIST INTO VIEW: a session's row, a project's heading or a group's, unfolding on the way — the sidebar's answers to the asks (asks.ts), which the tab bar and the panels make, and what a heading's jump menu and a new group do.
 * The sticky headings' height is measured here at each draw (`syncStickyOffset`), since a reveal lands its target clear of them.
 */

// Reveal a session's row in the sidebar (expanding its project if collapsed), so clicking a tab scrolls to where it lives and shows which project it belongs to.
// Answers whether the list has drawn the row: it has not while the list is on another project, a filter leaves the session out, or the session is finished or being deleted.
export function revealSession(session: SessionSummary): boolean {
  // Its group can be collapsed too, and then the row is hidden even with the project open.
  // Recent folds nothing, so it leaves Grouped's folds as they are.
  const { groupState, arrangement, reviewing } = store.get();
  const groupId = groupState.groupOf[entityKey(session)];
  if (arrangement === 'grouped' || reviewing) {
    if (groupId) unfold('groups', groupId);
    unfold('projects', session.repoRoot);
  }
  const row = sessionRows.find(entityKey(session));
  following = null;
  if (!row) return false;
  // A list out of sight has no layout to scroll, so the row is landed on once the list is on show again.
  if (container.getClientRects().length === 0) {
    following = session;
    return true;
  }
  // Scroll only the sidebar list (scrollIntoView would also scroll the page and shift the whole app).
  // Land the row clear of EVERYTHING pinned above it: the project heading always, plus its group's heading when the row sits in a group — that one is sticky too, and a fixed offset for the project heading alone left the row half-hidden behind it.
  const groupHeading = groupId ? groupSections.find(groupId)?.heading : undefined;
  const pinned = stickyOffset + (groupHeading?.getBoundingClientRect().height ?? 0);
  container.scrollTop +=
    row.getBoundingClientRect().top - container.getBoundingClientRect().top - pinned - REVEAL_GAP;
  return true;
}

/** A little air between a revealed row and the headings pinned above it, so it doesn't sit flush. */
const REVEAL_GAP = 6;

/** The session last revealed while the list was out of sight, such as behind a folded sidebar, whose row is landed on when the list next takes up room; null once landed or overtaken by another reveal. */
let following: SessionSummary | null = null;
new ResizeObserver(() => {
  if (following && container.getClientRects().length > 0) revealSession(following);
}).observe(container);

/**
 * In Recent, where no heading says where a project's or a group's sessions are, the tab bar's names land on the newest row drawn of that project, or of that group, or of the project's sessions in no group for `null`, and flash it (decided 2026-11-04); true where Recent is on show, whether or not such a row is drawn.
 */
function revealInRecent(holds: (session: SessionSummary) => boolean): boolean {
  const { arrangement, reviewing } = store.get();
  if (arrangement !== 'recent' || reviewing) return false;
  const row = [...container.querySelectorAll<HTMLElement>('.session')].find((each) => {
    const session = currentByKey.get(each.dataset.key ?? '');
    return session !== undefined && holds(session);
  });
  if (row) {
    container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - REVEAL_GAP;
    flash(row);
  }
  return true;
}

// Scroll the (All-view) session list to a project's heading — used by the project name in the tab bar, so it links to where that project's sessions live.
export function revealProject(repoRoot: string): void {
  following = null;
  if (revealInRecent((session) => session.repoRoot === repoRoot)) return;
  unfold('projects', repoRoot);
  const els = projectSections.find(repoRoot);
  if (!els) return;
  container.scrollTop += els.section.getBoundingClientRect().top - container.getBoundingClientRect().top;
  // Flashed as a group's heading is after a jump, so the tab bar's project and group labels do the same thing at their own level.
  flash(els.heading);
}

// The group headings pin below the project heading, so their sticky offset is its height.
// Measured rather than assumed: it moves with the type scale, and both this and the jump offset read the same element so they cannot drift apart.
// Skipped when unchanged, so a render doesn't thrash layout.
let stickyOffset = 0;
export function syncStickyOffset(): void {
  const first = projectSections.values().next().value;
  if (!first) return;
  const height = Math.round(first.heading.getBoundingClientRect().height);
  if (!height || height === stickyOffset) return;
  stickyOffset = height;
  document.documentElement.style.setProperty('--project-heading-height', `${height}px`);
}

// Jump to one of a project's groups (or to where its ungrouped sessions start).
// Expands the target if it is folded — otherwise the jump lands on a heading with nothing under it — and lands it just below the project heading, whose height is MEASURED rather than assumed: it changes with the type scale, and a stale constant would tuck the target under the sticky heading.
export function revealGroup(repoRoot: string, groupId: string | null): void {
  following = null;
  const { groupOf } = store.get().groupState;
  if (revealInRecent((session) => session.repoRoot === repoRoot && (groupOf[entityKey(session)] ?? null) === groupId)) return;
  const els = projectSections.find(repoRoot);
  if (!els) return;
  unfold('projects', repoRoot);
  if (groupId !== null) unfold('groups', groupId);

  // A group lands at its section's top and flashes its heading: the heading is sticky, so where it is drawn is not where the group starts — pinned already from inside the group, at the group's end from below it.
  // The ungrouped remainder has no heading, so it lands on and flashes its first row, the one carrying .after-groups, the class that marks where the loose rows begin.
  const group = groupId !== null ? groupSections.find(groupId) : undefined;
  const landing: HTMLElement | null | undefined =
    groupId !== null
      ? group?.section
      : els.section.querySelector<HTMLElement>(':scope > .session.after-groups') ??
        els.section.querySelector<HTMLElement>(':scope > .session');
  if (!landing) return;

  const offset = els.heading.getBoundingClientRect().height;
  container.scrollTop += landing.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
  flash(group?.heading ?? landing);
}
