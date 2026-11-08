import type { SessionSummary } from '../../../../shared/types';
import { placeChildren } from '../../../keyed';
import { structuralSignature, buildProjectTree, entityKey, type ProjectTree, groupJumpTargets, projectGoneReason } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { onMinute } from '../../../moments';
import { sameOrder, store, type TabState, type View } from '../../../state/app';
import { finishedOnlyProjects, isFiltering, mutedNeedsYou, projName, searchText, statusChanges, strengthNow, tabDotChanges, tabOnShow, tabWith, viewPool, visibleSessions } from '../../../state/views';
import { applyStatus } from '../../../statusdot';
import { folderIcon } from '../../../svg';
import { setUnavailable } from '../../../unavailable';
import { recentOrder } from '../../../recent';
import { reviewCount, type ReviewSection } from '../../../review';
import { endBulk } from '../../../state/bulk';
import { container, currentByKey, drawnKeys, groupSections, jumpTrees, projectFacts, projectSections, renderedSections, flatSections, rowTabMarks, type FlatSection, sessionRows, statusDots } from './drawn';
import { groupNameByKey, passesFilters, updateFilterStatus } from './filter';
import { bulkFollows, showBulk } from './bulk';
import { applyFolds, foldsFollow, updateCollapseToggle } from './folding';
import { createFlatSection, createGroupSection, createProjectSection } from './headings';
import { whereOf } from './describe';
import { reviewFlat, reviewInScope } from './review';
import { syncStickyOffset } from './reveal';
import { drawRow, showTabMarks, updateRow, type FlatLine, type RowView } from './rows';
import './list.css';

/**
 * The sidebar's session list, drawn: a section per project holding its groups and then its loose rows, each row a session's card, reconciled with what is on screen on every render and kept current by its watchers.
 * Its parts: the sections and their headings (headings.ts), the rows (rows.ts), the menus and the writes they make (actions.ts), the folds and collapse-all (folding.ts), bringing a row or a heading into view (reveal.ts), and what is on screen by key (drawn.ts).
 * It follows the store (`listChanged`, `listFollowsTabs`, `dotsFollowStatuses`, `foldsFollow`, registered by `watchList` in the sidebar's repaints, watch.ts); what it draws is read from main in one change (`fullRead`, read.ts).
 */

function updateSidebarHighlight(view: View<'tabs' | 'activeTab'>): void {
  const shown = tabOnShow(view);
  for (const row of sessionRows.values()) {
    const id = row.dataset.sid ?? '';
    const tab = tabWith(id, view);
    row.classList.toggle('open', tab !== undefined);
    // "Has a tab" and "is running" stopped being the same thing once tabs restore cold, so the row says which: an accent bar for a live session, a muted one for a tab waiting to be resumed.
    row.classList.toggle('cold', tab?.terminalId === null);
    row.classList.toggle('active-session', shown?.session.id === id);
  }
}

/**
 * A tab opened, started, stopped, closed or came on show: the rows' marks follow, and the list itself is drawn again only when what it draws from the tabs moved since it last followed them (`before`).
 * The open and live filters ask which sessions have a tab and which of those run, and a session with no transcript yet is in the list only through its tab's stand-in row.
 */
function listFollowsTabs(view: ListView, { tabs: before }: View<'tabs'>): void {
  const onDisk = new Set(view.sessions.map((s) => s.id));
  const keys = (tabs: readonly TabState[], running: boolean): string =>
    tabs
      .filter((t) => !running || t.terminalId !== null)
      .map((t) => entityKey(t.session))
      .sort()
      .join('\n');
  const standIns = (tabs: readonly TabState[]): string => structuralSignature(tabs.filter((t) => !onDisk.has(t.session.id)).map((t) => t.session));
  const { open, live } = view.filter.filters;
  const moved =
    // The review holds only sessions without a tab, so one that gets a tab, or loses one, moves it.
    (view.reviewing && keys(before, false) !== keys(view.tabs, false)) ||
    (open && keys(before, false) !== keys(view.tabs, false)) ||
    (live && keys(before, true) !== keys(view.tabs, true)) ||
    standIns(before) !== standIns(view.tabs);
  if (moved) renderList(view);
  else {
    updateSidebarHighlight(view);
    // A tab whose claude was asked to leave, or went, changes what its session's dot shows (`dotStatus`).
    repaintDots(tabDotChanges({ tabs: before }, view), view);
    // And one whose claude went, or reported again, what its clock shows (`clockOf`); and one whose stop has gone on, whether it says claude has not left.
    for (const [id, marks] of rowTabMarks) showTabMarks(marks, id, view);
  }
}

/** Repaint the dots of these sessions' rows, those drawn, from what each shows now. */
function repaintDots(ids: Set<string>, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'finished' | 'settings' | 'needsYouTypes'>): void {
  for (const id of ids) {
    const dot = statusDots.get(id);
    if (dot) applyStatus(dot, id, view);
  }
}

/**
 * A status, the work behind one, a mark read, a needs-you mark or a set-aside mark, which can mute it, changed, or the strength order or the categories that place a reason in it: repaint the rows' dots that differ from what they were last painted from (`before`).
 * Not the list: it paints every dot it draws itself, and this is what keeps them current between its renders.
 */
function dotsFollowStatuses(
  view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'finished' | 'settings' | 'needsYouTypes'>,
  before: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'settings' | 'needsYouTypes'>,
): void {
  repaintDots(statusChanges(before, view), view);
}

/** What draws the list again: the listing, a model switch, a pin, the finished marks, a note, a set-aside mark, a delete in flight, the groups, a project's name or place, the project on show, the filter, what GitHub says of the PRs, a task claude scheduled, Grouped or Recent, and for the review, a keep stamp, the review opening or ending, and the settings, which say whether GitHub is asked. */
const LIST_TOLD = ['sessions', 'switchedModel', 'pinned', 'finished', 'notes', 'setAside', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter', 'prStatus', 'scheduledTasks', 'arrangement', 'kept', 'reviewing', 'settings'] as const;
/** The tabs, which have a watcher of their own (`listFollowsTabs`), since most of a tab's changes move only the rows' marks. */
const LIST_TABS = ['tabs', 'activeTab'] as const;
/**
 * What the list reads and is never told of: a status change repaints only the dots (`dotsFollowStatuses`); a fold only folds what is drawn (`foldsFollow`); and whether the filter panel is open.
 */
const LIST_QUIET = ['statuses', 'backgroundTasks', 'acked', 'needsYou', 'needsYouTypes', 'folds', 'filterPanelOpen', 'bulk'] as const;

/** Everything the list draws from the store. */
type ListView = View<(typeof LIST_TOLD)[number] | (typeof LIST_TABS)[number] | (typeof LIST_QUIET)[number]>;

/** The list's watchers, registered in the sidebar's repaints (watch.ts), each slice named once above. */
export function watchList(): void {
  store.watch(LIST_TOLD, listChanged, { reads: [...LIST_TABS, ...LIST_QUIET] });
  store.watch(LIST_TABS, listFollowsTabs, { reads: [...LIST_TOLD, ...LIST_QUIET] });
  store.watch(['statuses', 'backgroundTasks', 'acked', 'needsYou', 'setAside', 'settings', 'needsYouTypes'], dotsFollowStatuses, { reads: ['tabs', 'finished'] });
  store.watch(['folds'], foldsFollow, { reads: ['filter', 'activeProject', 'arrangement'] });
  // Bulk mode draws its boxes, its count and its acts over the rows as drawn, without drawing the list again; the tabs say what Stop and Close can do, and turning the finished view on or off ends it outside the review.
  store.watch(['bulk', 'tabs', 'filter'], bulkFollows, { reads: ['reviewing', 'activeProject', 'projectNames'] });
  // The order catching up with the sessions' activity, and an open review with sessions crossing their days or a keep stamp running out, all with nothing in the store moving.
  onMinute(catchUp);
}

/** The list follows the store, with the filter's count and chips it draws. */
function listChanged(view: ListView, before: View<'filter' | 'activeProject' | 'arrangement'>): void {
  const reshaped = view.filter !== before.filter || view.activeProject !== before.activeProject || view.arrangement !== before.arrangement;
  renderList(view);
  // A new filter, another project or the other arrangement reshapes the list, so it starts at the top rather than at a stale scroll offset — whoever chose the project, the switcher or a new tab elsewhere dropping the list to All.
  if (reshaped) container.scrollTop = 0;
}

// Render from the cached session list, applying the current search filter.
// Keystrokes call this directly so filtering never re-reads disk.
// Keeps project, group and row nodes by key and leaves in place what already is (keyed.ts), so a re-render does not rebuild the sidebar: no flicker, the scroll stays put, and a press or the focus on a row that keeps its place survives it.
/**
 * What the list draws, worked out from the store and the clock and nothing else, so a draw and the minute's look at whether the order moved (`catchUp`) cannot disagree about it: the review's sets while it is open, else the sessions in scope that pass the filter, with what the filter's count says, by project and group or in Recent flat (`recentOrder`).
 * In Recent, `finished` says why there are no rows when every session in scope is finished and no filter is on, which Grouped says under each such project's heading.
 */
type ListShape =
  | { review: ReviewSection[] }
  | ({ all: SessionSummary[]; matches: number; total: number } & ({ tree: ProjectTree[] } | { recent: SessionSummary[]; finished: string | null }));

function listShape(view: ListView): ListShape {
  // The review in place of the projects (docs/architecture/session-list.md § The review): its sets in the switcher's scope, the filter set aside meanwhile.
  if (view.reviewing) return { review: reviewInScope(view) };
  // Include new sessions not yet written to disk (from their open tabs) so they appear in the list immediately, in the right project; they reconcile to the real entry once created.
  const all = visibleSessions(view);
  const { activeProject } = view;

  const groupNames = searchText(view) ? groupNameByKey(view) : undefined;
  const filtered = all.filter((s) => passesFilters(s, view, groupNames));
  // Project scope applies everywhere, the finished view included.
  // It used to be exempt, from when finished was a rarely-visited global bin — but the scope is an explicit statement of what you are looking at, and one view quietly overriding it reads as a leak.
  // Switch to All to find a finished session whose project you have forgotten.
  const inScope = (list: SessionSummary[]): SessionSummary[] => (activeProject ? list.filter((s) => s.repoRoot === activeProject) : list);
  const scoped = inScope(filtered);
  // The total is the set the matches were taken from: the same project scope and the same view, finished or not, before the other filters.
  // So the count only ever compares a set with part of itself, and in the normal view the total is the number the switcher shows.
  const total = inScope(viewPool(all, view.filter.filters.finished, view)).length;
  // A project whose sessions are all finished stays, empty and saying so, as it does in the switcher; a filter leaves it out, as it leaves out any project with no match, and the finished view lists it with its sessions.
  const finishedOnly = new Map(isFiltering(view) ? [] : [...finishedOnlyProjects(view)].filter(([repoRoot]) => !activeProject || repoRoot === activeProject));
  if (view.arrangement === 'recent') {
    // Nothing to list, and no filter: every session in scope is finished, the project on show's or in All every project's, which Recent says in place of its rows, as Grouped says it under each such project's heading.
    const finished = scoped.length === 0 && finishedOnly.size > 0 ? [...finishedOnly.values()].reduce((count, sessions) => count + sessions.length, 0) : null;
    return { recent: recentOrder(scoped), finished: finished === null ? null : allFinishedLine(finished), all, matches: scoped.length, total };
  }
  if (scoped.length === 0 && finishedOnly.size === 0) return { tree: [], all, matches: 0, total };
  // One section per repo, each holding its groups and then the sessions in no group.
  // Every ordering rule (groups first, pins floated inside their own section) lives in the pure builder.
  // While filtering, groups whose sessions all fell out are dropped rather than left as empty headings.
  return { tree: buildProjectTree(scoped, view.groupState, view.pinned, isFiltering(view), view.projectOrder, finishedOnly, all), all, matches: scoped.length, total };
}

/** The keys of the rows a shape draws, in the order it draws them: a project's groups' rows, then its loose rows (`reconcileProjectSections`), each set's rows in turn, or Recent's. */
function keysOf(shape: ListShape): string[] {
  if ('review' in shape) return shape.review.flatMap((set) => set.rows.map(({ session }) => entityKey(session)));
  if ('recent' in shape) return shape.recent.map(entityKey);
  return shape.tree.flatMap((project) => [...project.groups.flatMap((g) => g.sessions), ...project.loose].map(entityKey));
}

/** What is said where every session is finished: under a project's heading in Grouped, and in place of the list in Recent, for the project on show or for All. */
function allFinishedLine(count: number): string {
  return count === 1 ? 'Its only session is finished.' : `All ${count} sessions here are finished.`;
}

/**
 * At each minute's tick, the list drawn again where the order it would draw now differs from the one drawn (docs/architecture/ui-conventions.md § UI conventions): a session's last activity moves its place with nothing in the store telling the list (`AFFECTS_ROW`, logic.ts), and the review gains or loses a session as it crosses its days.
 * Held while the pointer is over the list, the focus is in it, or a menu opened from it is up, since a row must not move from under a press; the next tick tries again, so nothing waits on the pointer leaving.
 * A menu sits on the page's body, out of `:focus-within`'s reach, so it is found by the mark its trigger in the list wears while it is up (`.menu-open`).
 */
function catchUp(): void {
  if (container.matches(':hover, :focus-within') || container.querySelector('.menu-open')) return;
  const view = store.get();
  if (!sameOrder(keysOf(listShape(view)), drawnKeys())) renderList(view);
}

function renderList(view: ListView): void {
  const shape = listShape(view);
  if ('review' in shape) {
    // A review left with nothing in it ends, as an empty review has nothing to decide; said by nothing of its own: the act that emptied it raises its toast after this, with the Undo that matters more, and the Review button then says there is nothing to review.
    if (reviewCount(shape.review) === 0) endBulk();
    else renderSections(reviewFlat(shape.review), view);
    return;
  }
  const { all } = shape;
  updateFilterStatus(shape.matches, shape.total, view);
  const nothing = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';

  if ('recent' in shape) {
    if (shape.recent.length === 0) showEmpty(shape.finished ?? nothing, view);
    else {
      // One section without a heading; its id is its own for good, never one of the review's (`FlatSection`).
      renderSections([{ id: 'recent', heading: null, rows: shape.recent, why: null }], view);
      updateCollapseToggle(view);
    }
    return;
  }
  const { tree } = shape;
  const scroll = container.scrollTop;
  statusDots.clear();
  rowTabMarks.clear();
  currentByKey.clear();
  for (const s of all) currentByKey.set(entityKey(s), s);

  if (tree.length === 0) {
    showEmpty(nothing, view);
    return;
  }

  renderedSections.projects = tree.map((p) => p.repoRoot);
  renderedSections.groups = tree.flatMap((p) => p.groups.map((g) => g.group.id));
  reconcileProjectSections(tree, view);

  container.scrollTop = scroll;
  updateSidebarHighlight(view);
  updateCollapseToggle(view);
  syncStickyOffset();
  // The rows this draw made have no box drawn yet, and those it took away no longer count.
  showBulk(view);
}

/**
 * The list drawn flat, in place of the projects: each section a heading over its rows where it has one, its rows the list's own, in the order given, each led by where it sits where the scope does not say it, then why it is there where its section says, else what the row says otherwise (`updateRow`).
 * The folds have nothing to fold here.
 */
function renderSections(sections: readonly FlatSection[], view: ListView): void {
  statusDots.clear();
  rowTabMarks.clear();
  currentByKey.clear();
  for (const s of visibleSessions(view)) currentByKey.set(entityKey(s), s);
  const drawn = sections.map((section) => {
    const els = flatSections.draw(section.id, () => createFlatSection(section.heading !== null));
    if (els.heading && section.heading) {
      els.heading.label.textContent = section.heading.name;
      els.heading.count.textContent = String(section.heading.count);
      els.heading.note.textContent = section.heading.note ?? '';
      els.heading.note.hidden = section.heading.note === null;
    }
    // Where it sits, worked out again at each tick from the store as it then is.
    const line: FlatLine = { lead: (shown) => whereOf(shown, store.get()), why: section.why };
    const rows = section.rows.map((session) => {
      const row = drawRow(entityKey(session));
      updateRow(row, session, view, line);
      row.classList.remove('after-groups');
      return row;
    });
    placeChildren(els.rows, rows);
    return els.section;
  });
  placeChildren(container, drawn);
  renderedSections.projects = [];
  renderedSections.groups = [];
  projectSections.sweep();
  groupSections.sweep();
  flatSections.sweep();
  sessionRows.sweep();
  updateSidebarHighlight(view);
  showBulk(view);
}

/** The list with nothing to draw, saying `text` in place of its rows. */
function showEmpty(text: string, view: ListView): void {
  clearList();
  currentByKey.clear();
  for (const s of visibleSessions(view)) currentByKey.set(entityKey(s), s);
  const message = document.createElement('div');
  message.className = 'empty-message';
  message.textContent = text;
  container.append(message);
  // Nothing on screen to fold away: this early return would otherwise leave the toggle live with the previous render's sections.
  renderedSections.projects = [];
  renderedSections.groups = [];
  updateCollapseToggle(view);
  showBulk(view);
}

// Reset to a blank list: drop every cached node so the next non-empty render rebuilds fresh.
function clearList(): void {
  container.replaceChildren();
  sessionRows.clear();
  projectSections.clear();
  groupSections.clear();
  flatSections.clear();
  statusDots.clear();
  rowTabMarks.clear();
}

// Bring the project sections in line with `desired`: draw each section, group and row, place them in order, and sweep away what is no longer drawn.
// Inside a project the group sections come first, then the rows belonging to no group.
function reconcileProjectSections(desired: ProjectTree[], view: RowView & View<'projectNames' | 'activeProject' | 'folds'>): void {
  const sections: HTMLElement[] = [];
  for (const project of desired) {
    const els = projectSections.draw(project.repoRoot, createProjectSection);
    els.count.textContent = String(project.count);
    els.label.textContent = projName(project.repoRoot, view); // keep the heading current (e.g. after a rename)
    // Below 2 targets there is nowhere to jump, and the heading is already carrying six controls at a 320px sidebar — so the button is absent rather than dimmed.
    // Under a filter it offers the places the filter left drawn, and a pick unfolds the filter's own folds on the way.
    const targets = groupJumpTargets(project, view.statuses, view.acked, view.needsYou, mutedNeedsYou(view), strengthNow(view));
    jumpTrees.set(project.repoRoot, project);
    els.groupsBtn.hidden = targets.length < 2;
    // Nothing can be started in a folder that is not there.
    // Disabled rather than hidden: the project still has sessions to read, and a control that vanishes explains nothing — the tooltip does.
    const rootGone = !project.rootExists;
    const goneReason = rootGone ? projectGoneReason(project.repoRoot) : null;
    projectFacts.set(project.repoRoot, { isRepo: project.isRepo, goneReason });
    setUnavailable(els.addBtn, goneReason, 'New session in this project');
    setUnavailable(els.addCaret, goneReason, 'New session options');
    markProjectGone(project.repoRoot, rootGone, els.label, els.icon, 14, els.label, folderIcon(14));
    const groups: HTMLElement[] = [];
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.draw(group.id, createGroupSection);
      groupEls.label.textContent = group.name;
      groupEls.count.textContent = String(sessions.length);
      // A group starts its sessions in the project's folder, so it is gated by the same fact.
      setUnavailable(groupEls.addBtn, goneReason, 'New session in this group');
      setUnavailable(groupEls.addCaret, goneReason, 'New session options');
      groupEls.empty.hidden = sessions.length > 0;
      // Both ways to fill it, or only the move where the project's folder is gone and nothing can be started.
      // A control is named the way its tooltip names it ("Session options") rather than drawn as a glyph in text, which rendered in whatever the UI font offered; "+" is plain ASCII, so it is named as itself.
      groupEls.empty.textContent = rootGone
        ? "Empty — move a session here from any session's options."
        : "Empty — start a session with the + above, or move one here from any session's options.";
      const members = sessions.map((session) => {
        const row = drawRow(entityKey(session));
        updateRow(row, session, view);
        row.classList.remove('after-groups'); // rows are reused: it may have been a loose row before
        return row;
      });
      placeChildren(groupEls.members, [groupEls.empty, ...members]);
      groups.push(groupEls.section);
    }
    // Ungrouped sessions sit directly under the project heading, at full width — there is no "Ungrouped" heading, so the indent alone says whether a row is in a group.
    const loose = project.loose.map((session, index) => {
      const row = drawRow(entityKey(session));
      updateRow(row, session, view);
      // Extra breathing room between the last group and the loose rows, but not when there are no groups at all (then this is just the project's first row).
      row.classList.toggle('after-groups', index === 0 && project.groups.length > 0);
      return row;
    });
    // Its groups stay with it, so they can be filled again; the line goes above them, under the heading it explains.
    els.allFinishedLine.textContent = allFinishedLine(project.finished);
    placeChildren(els.section, [els.heading, ...(project.finished > 0 ? [els.allFinishedLine] : []), ...groups, ...loose]);
    sections.push(els.section);
  }
  placeChildren(container, sections);
  // What this render did not draw is gone: a project or a group no longer shown, a session deleted or filtered out.
  projectSections.sweep();
  groupSections.sweep();
  flatSections.sweep();
  sessionRows.sweep();
  applyFolds(view);
}
