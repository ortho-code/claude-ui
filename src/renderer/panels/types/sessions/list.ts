import type { SessionSummary } from '../../../../shared/types';
// Its rows are the card and its headings the section heading a list panel draws too.
import { listCard, sectionHeading } from '../../../card';
import {
  structuralSignature,
  buildProjectTree,
  entityKey,
  type ProjectTree,
  groupJumpTargets,
  relativeTime,
  modelLabel,
  unstartableReason,
  projectGoneReason,
  sessionLabel,
} from '../../../logic';
import { openMenu, type MenuItem } from '../../../menu';
import { markProjectGone } from '../../../projectgone';
import { store, type TabState, type View } from '../../../state/app';
import { isFiltering, projName, searchText, statusChanges, tabOnShow, tabWith, viewPool, visibleSessions } from '../../../state/views';
import { ackOnClick, applyStatus } from '../../../statusdot';
import { chevronIcon, folderIcon, layersIcon, NOTE_ICON, PIN_ICON, PINNED_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../svg';
import { showToast } from '../../../toast';
import { setTooltip } from '../../../tooltip';
import { setUnavailable, unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import {
  confirmAndDelete,
  copyText,
  deleteGroupById,
  editNote,
  groupMoveItems,
  openSiblingsMenu,
  projectMoveItems,
  promptNewGroup,
  renameGroupById,
  renameProject,
  sessionMenuItems,
  toggleArchiveFor,
  togglePinFor,
  withMoves,
} from './actions';
import { container, currentByKey, groupSections, jumpTargets, projectSections, renderedSections, sessionRows, statusDots, type GroupSectionEls, type ProjectSectionEls } from './drawn';
import { groupNameByKey, passesFilters, updateFilterStatus } from './filter';
import { applyFolds, foldsFollow, toggleFold, updateCollapseToggle } from './folding';
import { jumpToGroup, syncStickyOffset } from './reveal';
import './list.css';

/**
 * The sidebar's session list: a section per project holding its groups and then its loose rows, each row a session's card with its marks and controls. The menus on its rows and headings and the writes they make are actions.ts's, its folds and collapse-all folding.ts's, and bringing a row or a heading into view reveal.ts's.
 * It follows the store (`listChanged`, `listFollowsTabs`, `dotsFollowStatuses`, `foldsFollow`, registered by `watchList` in the sidebar's repaints, watch.ts); what it draws is read from main in one change (`renderSessions`, read.ts).
 */

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family and worktree marks in svg.ts).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
// Dots, so it stays a kebab rather than becoming a dashed line. The radius is in px for the same reason the stroke is: three 2.6px dots whatever the button's size.
const kebabIcon = (size: number): string => {
  const r = ((1.3 * 16) / size).toFixed(2);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor"><circle cx="8" cy="3.4" r="${r}" /><circle cx="8" cy="8" r="${r}" /><circle cx="8" cy="12.6" r="${r}" /></svg>`;
};

/**
 * A kebab: the options behind a ⋮, listed afresh at each click by `items`, which answers null when there is nothing to offer.
 * The click goes no further, so it neither folds a heading nor opens a row.
 */
function kebabButton(className: string, tooltip: string, items: () => MenuItem[] | null): HTMLButtonElement {
  const kebab = document.createElement('button');
  kebab.className = `icon-btn ${className}`;
  kebab.innerHTML = kebabIcon(14);
  setTooltip(kebab, tooltip);
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = items();
    if (menu) openMenu(kebab, menu);
  });
  return kebab;
}

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

/** The model to show for a session: the one it has switched to if we saw that happen, else the one that last answered. */
function modelOf(session: SessionSummary, view: View<'switchedModel'>): string {
  return view.switchedModel.get(session.id) ?? session.model;
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
// Reuses project/row nodes by key so a re-render moves elements into place instead of rebuilding the sidebar (no flicker, scroll stays put).
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
  // The total is the set the matches were taken from: the same project scope and the same view, archived or not, before the other filters. So the count only ever compares a set with part of itself, and in the normal view the total is the number the switcher shows.
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
  container.querySelector(':scope > .empty-message')?.remove();

  // One section per repo, each holding its groups and then the sessions in no group.
  // Every ordering rule (groups first, pins floated inside their own section) lives in the pure builder.
  // While filtering, groups whose sessions all fell out are dropped rather than left as empty headings.
  const tree = buildProjectTree(scoped, view.groupState, view.pinned, isFiltering(view), view.projectOrder);
  renderedSections.projects = tree.map((p) => p.repoRoot);
  renderedSections.groups = tree.flatMap((p) => p.groups.map((g) => g.group.id));
  reconcileProjectSections(tree, view);
  pruneRows(new Set(scoped.map((s) => entityKey(s))));

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

// Bring the project sections in line with `desired`: drop gone ones, create missing ones, and order both the sections and their rows via appendChild (which moves an existing node into place).
// Inside a project the group sections come first, then the rows belonging to no group.
function reconcileProjectSections(desired: ProjectTree[], view: RowView & View<'projectNames' | 'activeProject' | 'folds'>): void {
  const wanted = new Set(desired.map((p) => p.repoRoot));
  for (const [repoRoot, els] of projectSections) {
    if (!wanted.has(repoRoot)) {
      els.section.remove();
      projectSections.delete(repoRoot);
    }
  }
  const wantedGroups = new Set(desired.flatMap((p) => p.groups.map((g) => g.group.id)));
  for (const [id, els] of groupSections) {
    if (!wantedGroups.has(id)) {
      els.section.remove();
      groupSections.delete(id);
    }
  }
  for (const project of desired) {
    let els = projectSections.get(project.repoRoot);
    if (!els) {
      els = createProjectSection(project.repoRoot);
      projectSections.set(project.repoRoot, els);
    }
    els.count.textContent = String(project.count);
    els.label.textContent = projName(project.repoRoot, view); // keep the heading current (e.g. after a rename)
    // Below 2 targets there is nowhere to jump, and the heading is already carrying six controls at a 320px sidebar — so the button is absent rather than dimmed.
    // Filtering forces every section open and reshuffles what is on screen, which leaves the jump nothing to act on: disabled there, like collapse-all, since a control vanishing as you type reads worse than one plainly unavailable.
    const targets = groupJumpTargets(project, view.statuses, view.acked);
    jumpTargets.set(project.repoRoot, targets);
    els.groupsBtn.hidden = targets.length < 2;
    els.groupsBtn.disabled = isFiltering(view);
    els.addCaret.hidden = !project.isRepo; // worktree option only for git repos
    // Nothing can be started in a folder that is not there. Disabled rather than hidden: the project still has sessions to read, and a control that vanishes explains nothing — the tooltip does.
    const rootGone = !project.rootExists;
    const goneReason = rootGone ? projectGoneReason(project.repoRoot) : null;
    setUnavailable(els.addBtn, goneReason, 'New session in this project');
    setUnavailable(els.addCaret, goneReason, 'New session options');
    markProjectGone(project.repoRoot, rootGone, els.label, els.icon, 14, els.label, folderIcon(14));
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.get(group.id) ?? createGroupSection(group.id);
      groupSections.set(group.id, groupEls);
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
      for (const session of sessions) {
        const row = getOrCreateRow(entityKey(session));
        updateRow(row, session, view);
        row.classList.remove('after-groups'); // rows are reused: it may have been a loose row before
        groupEls.members.appendChild(row);
      }
      els.section.appendChild(groupEls.section);
    }
    // Ungrouped sessions sit directly under the project heading, at full width — there is no "Ungrouped" heading, so the indent alone says whether a row is in a group.
    let first = true;
    for (const session of project.loose) {
      const row = getOrCreateRow(entityKey(session));
      updateRow(row, session, view);
      // Extra breathing room between the last group and the loose rows, but not when there are no groups at all (then this is just the project's first row).
      row.classList.toggle('after-groups', first && project.groups.length > 0);
      first = false;
      els.section.appendChild(row);
    }
    container.appendChild(els.section);
  }
  applyFolds(view);
}

// Remove rows whose entity is no longer shown (deleted, or filtered out by search).
function pruneRows(wanted: Set<string>): void {
  for (const [key, row] of sessionRows) {
    if (!wanted.has(key)) {
      row.remove();
      sessionRows.delete(key);
    }
  }
}

interface NewSessionSplit {
  /** The class of the "+" and of the caret, which the heading's stylesheet sizes. */
  addClass: string;
  caretClass: string;
  /** The project heading's "+" is a 12px mark in a filled box, the group's a 14px one in a standard box (list.css). */
  plusSize: number;
  tooltip: string;
  /** Where to start a session at the click: the project's folder, and the group to file it in; null when there is none any more. */
  where: () => { repoRoot: string; groupId?: string } | null;
}

// A heading's new-session split button: the "+" is one-click "New session"; the caret opens a dropdown with the worktree variant too. reconcileProjectSections shows the caret only for git repos.
function newSessionSplit({ addClass, caretClass, plusSize, tooltip, where }: NewSessionSplit): { split: HTMLElement; add: HTMLButtonElement; addCaret: HTMLButtonElement } {
  const split = document.createElement('div');
  split.className = 'split-button';
  const add = document.createElement('button');
  add.className = `icon-btn composite ${addClass}`;
  add.innerHTML = plusIcon(plusSize);
  setTooltip(add, tooltip);
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(add)) return; // aria-disabled still delivers the click, which is the trade for a tooltip that works
    const at = where();
    if (at) void hostOf('sessions').openNewSession(at.repoRoot, at.groupId);
  });
  const addCaret = document.createElement('button');
  addCaret.className = `icon-btn composite ${caretClass}`;
  addCaret.innerHTML = chevronDown(9);
  addCaret.hidden = true;
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(addCaret)) return;
    const at = where();
    if (!at) return;
    openMenu(addCaret, [
      { label: 'New session', onSelect: () => void hostOf('sessions').openNewSession(at.repoRoot, at.groupId) },
      { label: 'New worktree session…', onSelect: () => void hostOf('sessions').openWorktreeSession(at.repoRoot, at.groupId) },
    ]);
  });
  split.append(add, addCaret);
  return { split, add, addCaret };
}

// Build a project section once; its contents (name, count, caret, rows) are drawn by reconcileProjectSections, on this render and every later one.
function createProjectSection(name: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const { heading, caret, icon, label, count } = sectionHeading('project', folderIcon(14));
  setTooltip(label, name); // full path on hover
  // Jump straight to one of this project's groups instead of scrolling for it.
  // The heading is position:sticky, so this trigger is on screen the whole time you scroll the project — which is what makes a menu enough here, rather than a panel that would cost a line of height per project.
  // reconcileProjectSections hides it below 2 targets and disables it while filtering.
  const groupsBtn = document.createElement('button');
  groupsBtn.className = 'icon-btn project-groups';
  groupsBtn.innerHTML = layersIcon(14);
  groupsBtn.hidden = true;
  setTooltip(groupsBtn, 'Jump to a group');
  groupsBtn.addEventListener('click', (event) => {
    event.stopPropagation(); // don't collapse the project
    const targets = jumpTargets.get(name) ?? [];
    const items: MenuItem[] = [];
    for (const t of targets) {
      // A rule before the ungrouped entry: it is a different KIND of target, not another group.
      if (t.groupId === null && items.length > 0) items.push({ label: '', separator: true });
      items.push({
        label: t.name,
        count: t.count,
        badge: t.badge,
        muted: t.groupId === null,
        onSelect: () => jumpToGroup(name, t.groupId),
      });
    }
    openMenu(groupsBtn, items);
  });
  heading.append(groupsBtn);
  const { split, add, addCaret } = newSessionSplit({
    addClass: 'project-add',
    caretClass: 'project-add-caret',
    plusSize: 12,
    tooltip: 'New session in this project',
    where: () => ({ repoRoot: name }),
  });
  heading.append(split);
  // Project options (rename now, hide later).
  const kebab = kebabButton('project-kebab', 'Project options', () =>
    withMoves(projectMoveItems(name), [
      { label: 'Rename…', onSelect: () => void renameProject(name) },
      { label: 'Copy path', onSelect: () => void copyText(name, 'Path copied.') },
      { label: '', separator: true },
      { label: 'New group…', onSelect: () => void promptNewGroup(name) },
    ]),
  );
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker.
  // Keep the clicked heading anchored: a sticky heading otherwise snaps between stuck and natural position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    // Not collapsible in a single-project view: hiding the one project you're looking at leaves an empty sidebar. The heading is a title there, and applyFolds drops its caret to say so.
    if (store.get().activeProject !== null) return;
    const before = heading.getBoundingClientRect().top;
    toggleFold('projects', name);
    container.scrollTop += heading.getBoundingClientRect().top - before;
  });
  section.appendChild(heading);

  return { section, heading, caret, count, icon, label, groupsBtn, addCaret, addBtn: add };
}

// Build a group's sub-section once: a heading (lighter than the project's — no divider, not sticky) over an indented well that holds its rows. Contents are updated on later renders.
function createGroupSection(id: string): GroupSectionEls {
  const section = document.createElement('section');
  section.className = 'group';

  const { heading, caret, label, count } = sectionHeading('bar', layersIcon(13));
  // Start a session already in this group, from a split button like the project heading's.
  const { split, add, addCaret } = newSessionSplit({
    addClass: 'group-add',
    caretClass: 'group-add-caret',
    plusSize: 14,
    tooltip: 'New session in this group',
    where: () => {
      const repoRoot = store.get().groupState.groups.find((g) => g.id === id)?.repoRoot;
      return repoRoot ? { repoRoot, groupId: id } : null;
    },
  });
  // Group options.
  const kebab = kebabButton('group-kebab', 'Group options', () =>
    withMoves(groupMoveItems(id), [
      { label: 'Rename…', onSelect: () => void renameGroupById(id) },
      { label: 'Delete group', onSelect: () => void deleteGroupById(id) },
    ]),
  );
  heading.append(split, kebab);
  heading.addEventListener('click', () => {
    toggleFold('groups', id);
  });

  // The rows live in their own element so the indent and its rail wrap the whole group, which is what shows where a group ends without needing to read the next heading.
  const members = document.createElement('div');
  members.className = 'group-members';
  const empty = document.createElement('div');
  empty.className = 'section-empty'; // its text depends on the project's folder, so reconcileProjectSections writes it
  members.append(empty);

  section.append(heading, members);
  return { section, heading, caret, label, count, addCaret, addBtn: add, members, empty };
}

function getOrCreateRow(key: string): HTMLElement {
  const existing = sessionRows.get(key);
  if (existing) return existing;
  const row = createSessionRow(key);
  sessionRows.set(key, row);
  return row;
}

// Take it back out of the box. Archiving has no row icon — it is a kebab item (text) in the normal view; only unarchiving, the archived view's primary action, stays a button on the row.
// Redrawn from its 24-unit original at two-thirds scale, onto the 16-unit grid the helper draws on.
const UNARCHIVE_ICON = strokeIcon(14, '<path d="M.67 2.67v4h4" /><path d="M2.34 10a6 6 0 1 0 1.42-6.24L.67 6.67" />');

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  siblingsBadge: HTMLElement;
  noteBadge: HTMLElement;
  noteSep: HTMLElement;
  meta: HTMLElement;
  metaText: HTMLElement;
  pin: HTMLButtonElement;
  unarchiveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  kebab: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

// Build a row once. Its click/pin handlers read the live session from `currentByKey` by the entity key (the session id), so a reused row stays correct across re-renders.
function createSessionRow(key: string): HTMLElement {
  const { card: item, content, title, meta } = listCard('session');
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => currentByKey.get(key)?.id ?? null);
  const badge = document.createElement('span');
  badge.className = 'worktree-badge';
  badge.hidden = true;
  // A family member's mark: the fork icon plus a count of its siblings, which opens a list of them to jump into. Shown only when session.isSibling (set in updateRow).
  const siblingsBadge = document.createElement('span');
  siblingsBadge.className = 'sibling-badge';
  siblingsBadge.hidden = true;
  siblingsBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) openSiblingsMenu(siblingsBadge, session);
  });
  // The card's meta line holds the time and model, plus the note mark riding along at the end of that text.
  // The mark lives HERE rather than beside the title because a sibling box next to a text block has to have its alignment guessed; inside the text row it just centres.
  // The meta is short and single-line, so nothing can clip the mark off the way a two-line title clamp would.
  const metaText = document.createElement('span');
  metaText.className = 'meta-text';
  // The badges used to take a line of their own between title and meta.
  // They ride the meta's line now: the meta takes the remaining width (and still stacks by itself if it must), the marks keep their intrinsic size at the right.
  // A note's mark, clickable straight into the editor — if you can see there's a note, the natural move is to read it, and the tooltip only previews the first line.
  const noteBadge = document.createElement('span');
  noteBadge.className = 'note-badge';
  noteBadge.hidden = true;
  noteBadge.innerHTML = NOTE_ICON;
  noteBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) void editNote(session);
  });

  // A separator before the mark, matching the " · " already between time and model. Hidden with the mark, so a row without a note doesn't end in a dangling dot.
  const noteSep = document.createElement('span');
  noteSep.className = 'meta-sep';
  noteSep.textContent = '·';
  noteSep.hidden = true;
  meta.append(metaText, noteSep, noteBadge);

  const subline = document.createElement('div');
  subline.className = 'session-subline';
  subline.append(meta, badge, siblingsBadge);
  content.append(subline);

  const pin = document.createElement('button');
  pin.className = 'icon-btn pin';
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    // Disabling it is the pending cue: .pin:disabled dims. (There was a 'loading' class here with no CSS behind it, so it painted nothing.)
    pin.disabled = true;
    void togglePinFor(key).then(() => {
      // The row's redraw re-enables it; this is for an answer that changed nothing, which tells nobody.
      pin.disabled = false;
    });
  });

  // Unarchive lives on the row because it is what the archived view is for; archiving a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  const unarchiveBtn = document.createElement('button');
  unarchiveBtn.className = 'icon-btn unarchive-btn';
  unarchiveBtn.hidden = true;
  unarchiveBtn.innerHTML = UNARCHIVE_ICON;
  setTooltip(unarchiveBtn, 'Unarchive');
  unarchiveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleArchiveFor(key);
  });

  // Delete lives only in the archived view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete-btn';
  setTooltip(deleteBtn, 'Delete session');
  deleteBtn.hidden = true;
  deleteBtn.innerHTML = strokeIcon(14, '<path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" />');
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void confirmAndDelete(key);
  });

  // Per-session actions menu: fork this session, and (for a family member) list its siblings.
  const kebab = kebabButton('session-kebab', 'Session options', () => {
    const session = currentByKey.get(key);
    return session ? sessionMenuItems(session) : null;
  });

  item.prepend(dot);
  item.append(pin, unarchiveBtn, deleteBtn, kebab);
  rowEls.set(item, { dot, title, badge, siblingsBadge, noteBadge, noteSep, meta, metaText, pin, unarchiveBtn, deleteBtn, kebab });
  item.addEventListener('click', () => {
    // Archived sessions are inert: manage them (unarchive/delete), don't resume them.
    if (store.get().filter.filters.archived) return;
    const session = currentByKey.get(key);
    if (!session) return;
    // A session whose folder is gone cannot run anywhere. The row says so in its tooltip, and this answers the click for anyone who tries it anyway rather than opening a tab that could only fail.
    const reason = unstartableReason(session);
    if (reason) {
      showToast(reason);
      return;
    }
    hostOf('sessions').openTab(session.id);
  });
  return item;
}

// Refresh a reused row's content for the tip it now shows.
/** What a row draws from the store besides the session it shows. */
type RowView = View<'statuses' | 'acked' | 'switchedModel' | 'pinned' | 'archived' | 'notes' | 'filter'>;

function updateRow(row: HTMLElement, session: SessionSummary, view: RowView): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;
  const archivedView = view.filter.filters.archived;

  applyStatus(els.dot, view.statuses.get(session.id), view.acked.has(session.id));
  statusDots.set(session.id, els.dot);

  els.title.textContent = sessionLabel(session, '(no prompt yet)');
  // A session that cannot run says why on the row itself, rather than only when you try it: the tooltip is the one place with room for the folder's path.
  const unstartable = unstartableReason(session);
  row.classList.toggle('unstartable', unstartable !== null);
  setTooltip(els.title, unstartable ?? (sessionLabel(session, '') || null));

  els.badge.hidden = !session.worktree;
  if (session.worktree) {
    // Icon only — the word "worktree" cost a badge-width of room and the branch icon plus its tooltip already say it. Being wordless, the pill carries its own aria-label.
    const wtIcon = document.createElement('span');
    wtIcon.className = 'badge-icon';
    wtIcon.innerHTML = WORKTREE_ICON;
    els.badge.replaceChildren(wtIcon);
    setTooltip(els.badge, `Linked git worktree: ${session.worktree}`);
    els.badge.setAttribute('aria-label', `Linked git worktree: ${session.worktree}`);
  }

  const note = view.notes.get(entityKey(session));
  els.noteBadge.hidden = !note;
  els.noteSep.hidden = !note;
  // Tooltips are one line, so preview the start rather than dumping a long note into it. The tooltip wraps and keeps line breaks now, so it can show a real chunk of the note.
  if (note) setTooltip(els.noteBadge, note.length > 400 ? `${note.slice(0, 400)}…` : note);

  els.siblingsBadge.hidden = !session.isSibling;
  if (session.isSibling) {
    const count = session.siblingIds.length;
    const sibIcon = document.createElement('span');
    sibIcon.className = 'badge-icon';
    sibIcon.innerHTML = SIBLING_ICON;
    const sibCount = document.createElement('span');
    sibCount.className = 'badge-text';
    sibCount.textContent = String(count);
    els.siblingsBadge.replaceChildren(sibIcon, sibCount);
    const label = count === 1 ? '1 sibling' : `${count} siblings`;
    setTooltip(els.siblingsBadge, `${label} in this session's family — click to list them`);
  }

  if (archivedView) {
    const ts = view.archived.get(entityKey(session));
    els.metaText.textContent = ts ? `archived ${relativeTime(new Date(ts).toISOString())}` : 'archived';
  } else {
    const model = modelLabel(modelOf(session, view));
    const when = relativeTime(session.lastActivity);
    els.metaText.textContent = model ? `${when} · ${model}` : when;
  }

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = view.pinned.has(entityKey(session));
  els.pin.innerHTML = isPinned ? PINNED_ICON : PIN_ICON;
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = archivedView;

  // Unarchive and delete are the archived view's two actions and appear nowhere else.
  els.unarchiveBtn.hidden = !archivedView;
  els.deleteBtn.hidden = !archivedView;
  // The kebab (fork, groups, archive) is a normal-view affordance; the archived view is manage-only.
  els.kebab.hidden = archivedView;
}
