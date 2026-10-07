import type { SessionSummary } from '../../../../shared/types';
import { placeChildren } from '../../../keyed';
import { structuralSignature, buildProjectTree, entityKey, type ProjectTree, groupJumpTargets, projectGoneReason } from '../../../logic';
import { markProjectGone } from '../../../projectgone';
import { store, type TabState, type View } from '../../../state/app';
import { isFiltering, projName, searchText, statusChanges, tabOnShow, tabWith, viewPool, visibleSessions } from '../../../state/views';
import { applyStatus } from '../../../statusdot';
import { folderIcon } from '../../../svg';
import { setUnavailable } from '../../../unavailable';
import { container, currentByKey, groupSections, jumpTargets, projectSections, renderedSections, sessionRows, statusDots } from './drawn';
import { groupNameByKey, passesFilters, updateFilterStatus } from './filter';
import { applyFolds, foldsFollow, updateCollapseToggle } from './folding';
import { createGroupSection, createProjectSection } from './headings';
import { syncStickyOffset } from './reveal';
import { drawRow, updateRow, type RowView } from './rows';
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
    (open && keys(before, false) !== keys(view.tabs, false)) ||
    (live && keys(before, true) !== keys(view.tabs, true)) ||
    standIns(before) !== standIns(view.tabs);
  if (moved) renderList(view);
  else updateSidebarHighlight(view);
}

/**
 * A status or a mark read changed: repaint the rows' dots that differ from what they were last painted from (`before`).
 * Not the list: it paints every dot it draws itself, and this is what keeps them current between its renders.
 */
function dotsFollowStatuses(view: View<'statuses' | 'acked'>, before: View<'statuses' | 'acked'>): void {
  const ids = statusChanges(before, view);
  for (const id of ids) {
    const dot = statusDots.get(id);
    if (dot) applyStatus(dot, view.statuses.get(id), view.acked.has(id));
  }
}

/** What draws the list again: the listing, a model switch, a pin, the archive, a note, a delete in flight, the groups, a project's name or place, the project on show, the filter. */
const LIST_TOLD = ['sessions', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter'] as const;
/** The tabs, which have a watcher of their own (`listFollowsTabs`), since most of a tab's changes move only the rows' marks. */
const LIST_TABS = ['tabs', 'activeTab'] as const;
/**
 * What the list reads and is never told of: a status change repaints only the dots (`dotsFollowStatuses`); a fold only folds what is drawn (`foldsFollow`); and whether the filter panel is open.
 */
const LIST_QUIET = ['statuses', 'acked', 'folds', 'filterPanelOpen'] as const;

/** Everything the list draws from the store. */
type ListView = View<(typeof LIST_TOLD)[number] | (typeof LIST_TABS)[number] | (typeof LIST_QUIET)[number]>;

/** The list's watchers, registered in the sidebar's repaints (watch.ts), each slice named once above. */
export function watchList(): void {
  store.watch(LIST_TOLD, listChanged, { reads: [...LIST_TABS, ...LIST_QUIET] });
  store.watch(LIST_TABS, listFollowsTabs, { reads: [...LIST_TOLD, ...LIST_QUIET] });
  store.watch(['statuses', 'acked'], dotsFollowStatuses);
  store.watch(['folds'], foldsFollow, { reads: ['filter', 'activeProject'] });
}

/** The list follows the store, with the filter's count and chips it draws. */
function listChanged(view: ListView, before: View<'filter' | 'activeProject'>): void {
  const reshaped = view.filter !== before.filter || view.activeProject !== before.activeProject;
  renderList(view);
  // A new filter or another project reshapes the list, so it starts at the top rather than at a stale scroll offset — whoever chose the project, the switcher or a new tab elsewhere dropping the list to All.
  if (reshaped) container.scrollTop = 0;
}

// Render from the cached session list, applying the current search filter.
// Keystrokes call this directly so filtering never re-reads disk.
// Keeps project, group and row nodes by key and leaves in place what already is (keyed.ts), so a re-render does not rebuild the sidebar: no flicker, the scroll stays put, and a press or the focus on a row that keeps its place survives it.
function renderList(view: ListView): void {
  const scroll = container.scrollTop;
  statusDots.clear();

  // Include new sessions not yet written to disk (from their open tabs) so they appear in the list immediately, in the right project; they reconcile to the real entry once created.
  const all = visibleSessions(view);
  currentByKey.clear();
  for (const s of all) currentByKey.set(entityKey(s), s);
  const { activeProject } = view;

  const groupNames = searchText(view) ? groupNameByKey(view) : undefined;
  const filtered = all.filter((s) => passesFilters(s, view, groupNames));
  // Project scope applies everywhere, the archived view included.
  // It used to be exempt, from when archived was a rarely-visited global bin — but the scope is an explicit statement of what you are looking at, and one view quietly overriding it reads as a leak.
  // Switch to All to find an archived session whose project you have forgotten.
  const inScope = (list: SessionSummary[]): SessionSummary[] => (activeProject ? list.filter((s) => s.repoRoot === activeProject) : list);
  const scoped = inScope(filtered);
  // The total is the set the matches were taken from: the same project scope and the same view, archived or not, before the other filters.
  // So the count only ever compares a set with part of itself, and in the normal view the total is the number the switcher shows.
  updateFilterStatus(scoped.length, inScope(viewPool(all, view.filter.filters.archived, view)).length, view);

  if (scoped.length === 0) {
    clearList();
    const message = document.createElement('div');
    message.className = 'empty-message';
    message.textContent = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    container.append(message);
    // Nothing on screen to fold away: this early return would otherwise leave the toggle live with the previous render's sections.
    renderedSections.projects = [];
    renderedSections.groups = [];
    updateCollapseToggle(view);
    return;
  }

  // One section per repo, each holding its groups and then the sessions in no group.
  // Every ordering rule (groups first, pins floated inside their own section) lives in the pure builder.
  // While filtering, groups whose sessions all fell out are dropped rather than left as empty headings.
  const tree = buildProjectTree(scoped, view.groupState, view.pinned, isFiltering(view), view.projectOrder);
  renderedSections.projects = tree.map((p) => p.repoRoot);
  renderedSections.groups = tree.flatMap((p) => p.groups.map((g) => g.group.id));
  reconcileProjectSections(tree, view);

  container.scrollTop = scroll;
  updateSidebarHighlight(view);
  updateCollapseToggle(view);
  syncStickyOffset();
}

// Reset to a blank list: drop every cached node so the next non-empty render rebuilds fresh.
function clearList(): void {
  container.replaceChildren();
  sessionRows.clear();
  projectSections.clear();
  groupSections.clear();
  statusDots.clear();
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
    // Filtering forces every section open and reshuffles what is on screen, which leaves the jump nothing to act on: disabled there, like collapse-all, since a control vanishing as you type reads worse than one plainly unavailable.
    const targets = groupJumpTargets(project, view.statuses, view.acked);
    jumpTargets.set(project.repoRoot, targets);
    els.groupsBtn.hidden = targets.length < 2;
    els.groupsBtn.disabled = isFiltering(view);
    els.addCaret.hidden = !project.isRepo; // worktree option only for git repos
    // Nothing can be started in a folder that is not there.
    // Disabled rather than hidden: the project still has sessions to read, and a control that vanishes explains nothing — the tooltip does.
    const rootGone = !project.rootExists;
    const goneReason = rootGone ? projectGoneReason(project.repoRoot) : null;
    setUnavailable(els.addBtn, goneReason, 'New session in this project');
    setUnavailable(els.addCaret, goneReason, 'New session options');
    markProjectGone(project.repoRoot, rootGone, els.label, els.icon, 14, els.label, folderIcon(14));
    const groups: HTMLElement[] = [];
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.draw(group.id, createGroupSection);
      groupEls.label.textContent = group.name;
      groupEls.count.textContent = String(sessions.length);
      groupEls.addCaret.hidden = !project.isRepo; // worktree option only for git repos
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
    placeChildren(els.section, [els.heading, ...groups, ...loose]);
    sections.push(els.section);
  }
  placeChildren(container, sections);
  // What this render did not draw is gone: a project or a group no longer shown, a session deleted or filtered out.
  projectSections.sweep();
  groupSections.sweep();
  sessionRows.sweep();
  applyFolds(view);
}
