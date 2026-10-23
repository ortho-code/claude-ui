import { prReference } from '../../../../shared/prs';
import type { OrderMove, SessionSummary } from '../../../../shared/types';
import { confirmDelete, promptText } from '../../../dialogs';
import { entityKey, folderName, relativeTime, sessionLabel, tabButtonLabel, tabButtonState, unstartableReason } from '../../../logic';
import { openMenu, type MenuItem } from '../../../menu';
import { verdictOf } from '../../../prstatus';
import { store, withMember } from '../../../state/app';
import { applyGroupState, moveSessionToGroup } from '../../../state/groups';
import { canMarkRead, toggleAck } from '../../../state/statuses';
import { isFiltering, isPaused, projName, projectGroups, tabWith, unopenableReason } from '../../../state/views';
import { showToast } from '../../../toast';
import type { SessionSurface } from '../../contract';
import { hostOf } from '../builtin';
import { sessionHeader } from './describe';
import { currentByKey, renderedSections } from './drawn';
import { fullRead } from './read';
import { revealGroup, revealSession } from './reveal';
import '../../../tone.css';
import '../../../prstatus.css';

/**
 * THE SESSION LIST'S MENUS AND THE WRITES THEY MAKE: a session's options and its pin, archive and delete; a group's and a project's options, their moves and renames, and a new group.
 * Each write goes through main and is set in the store, which the list follows; nothing here draws the list.
 */

/** A heading's options: its own, then its ordering moves last of all, below a rule when it has any (user, 2026-10-20). */
export function withMoves(moves: MenuItem[], own: MenuItem[]): MenuItem[] {
  return [...own, ...(moves.length > 0 ? [{ label: '', separator: true }] : []), ...moves];
}

// --- Session helpers ---

// Copy to the clipboard with a small confirmation toast; the OS gives no visible cue otherwise.
export async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch {
    showToast("Couldn't copy to the clipboard.");
  }
}

// A session's siblings (the other members of its family), most recent first.
// Shared by the count badge and the kebab submenu.
function siblingsOf(session: SessionSummary): SessionSummary[] {
  return store
    .get()
    .sessions.filter((s) => session.siblingIds.includes(s.id))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Menu items for a sibling list; siblings often share a title, so each shows title + when.
// One that cannot be opened, an archived one say, stays in the list, unavailable and saying why (`unopenableReason`).
function siblingMenuItems(siblings: SessionSummary[]): MenuItem[] {
  return siblings.map((sibling) => {
    const label = `${sessionLabel(sibling)} · ${relativeTime(sibling.lastActivity)}`;
    const refused = unopenableReason(sibling);
    return refused ? { label, disabled: refused } : { label, onSelect: () => hostOf('sessions').openSession(sibling.id) };
  });
}

// The PRs a session's transcript links, by their full reference, oldest first, each opening its page in the browser.
// Each led by a dot in its ink and followed by its state, from what GitHub last said (`verdictOf`); a PR with no status has the hollow dot of one thing with nothing to report (base.css's `.nudge.single`), and no words.
// Shared by the PR mark and the kebab submenu.
function prMenuItems(session: SessionSummary): MenuItem[] {
  const { prStatus } = store.get();
  return session.prs.map((pr) => {
    const { tone, words } = verdictOf(pr, prStatus);
    return {
      label: words === null ? prReference(pr) : `${prReference(pr)} · ${words}`,
      dot: words === null ? 'nudge single' : `nudge pr-dot pr-ink tone-${tone}`,
      onSelect: () => window.claudeUi.openExternal(pr.url),
    };
  });
}

// --- Group actions ------------------------------------------------------------------------------ Written through main, which hands back the whole state (state/groups.ts).

// Name a new group, create it in the project, and take the list to it.
// From a row it moves that session in at the same time, so the group is never briefly empty and the user never has to find it again to fill it; from the project heading it starts empty, to be filled from its own "+" or a row's "Move to group".
// A new group lands at the top of its project, which can be well away from the row or heading it was made from, so the jump — unfolding the project if it is folded — and its flash show where it went.
// A filter hides empty groups, so one made empty under a filter is not drawn, and the toast says where it went instead.
export async function promptNewGroup(repoRoot: string, sessionId?: string): Promise<void> {
  const name = await promptText('New group', projName(repoRoot, store.get()), '', 'Create');
  if (!name?.trim()) return;
  const known = new Set(store.get().groupState.groups.map((g) => g.id));
  applyGroupState(await window.claudeUi.createGroup(name, repoRoot, sessionId));
  // The list has drawn the answer by now: the store tells as it is set.
  const group = store.get().groupState.groups.find((g) => !known.has(g.id));
  if (!group) return;
  if (renderedSections.groups.includes(group.id)) revealGroup(repoRoot, group.id);
  else if (isFiltering(store.get())) showToast(`Group "${group.name}" created. Empty groups are hidden while a filter is on, so it shows once you clear it.`);
}

// The four ordering moves for whatever sits at `at` in an order of `count`, minus any that would be a no-op: the first has no "up", the last no "down", and a lone one has nowhere to go at all.
// So a menu never offers a move that does nothing; a group's and a project's both come from here.
function orderMoveItems(at: number, count: number, move: (move: OrderMove) => Promise<void>): MenuItem[] {
  const last = count - 1;
  if (at < 0 || last <= 0) return [];
  const item = (label: string, to: OrderMove): MenuItem => ({
    label,
    onSelect: () => void move(to),
  });
  const items: MenuItem[] = [];
  if (at > 0) items.push(item('Move to top', 'top'), item('Move up', 'up'));
  if (at < last) items.push(item('Move down', 'down'), item('Move to bottom', 'bottom'));
  return items;
}

// A group's ordering moves, among its project's groups.
export function groupMoveItems(id: string): MenuItem[] {
  // Not while filtering: filtering drops groups whose sessions all fell out, so a neighbour can be missing from the screen and the move would appear to do nothing.
  const state = store.get();
  if (isFiltering(state)) return [];
  const group = state.groupState.groups.find((g) => g.id === id);
  if (!group?.repoRoot) return [];
  const siblings = projectGroups(group.repoRoot, state);
  return orderMoveItems(siblings.findIndex((g) => g.id === id), siblings.length, (move) => moveGroupById(id, move));
}

async function moveGroupById(id: string, move: OrderMove): Promise<void> {
  applyGroupState(await window.claudeUi.moveGroup(id, move));
}

export async function renameGroupById(id: string): Promise<void> {
  const state = store.get();
  const group = state.groupState.groups.find((g) => g.id === id);
  if (!group) return;
  const name = await promptText('Rename group', projName(group.repoRoot ?? '', state), group.name);
  if (!name?.trim()) return;
  applyGroupState(await window.claudeUi.renameGroup(id, name));
}

// No confirmation: nothing is destroyed.
// The group goes and its members simply sit under the project again — unlike deleting a session, which trashes a transcript.
export async function deleteGroupById(id: string): Promise<void> {
  const group = store.get().groupState.groups.find((g) => g.id === id);
  applyGroupState(await window.claudeUi.deleteGroup(id));
  if (group) showToast(`Group "${group.name}" deleted. Its sessions are back under the project.`);
}

// The "Move to group" list: the project's groups with the current one ticked, then the two ways out — back to the project, or into a group that doesn't exist yet.
function moveToGroupItems(session: SessionSummary): MenuItem[] {
  const state = store.get();
  const current = state.groupState.groupOf[entityKey(session)];
  const items: MenuItem[] = projectGroups(session.repoRoot, state).map((group) => ({
    label: group.name,
    checked: group.id === current,
    onSelect: () => void moveSessionToGroup(session, group.id),
  }));
  if (items.length > 0) items.push({ label: '', separator: true });
  items.push({ label: 'None', checked: !current, onSelect: () => void moveSessionToGroup(session, null) });
  items.push({ label: 'New group…', onSelect: () => void promptNewGroup(session.repoRoot, entityKey(session)) });
  return items;
}

// Archive/unarchive one session.
// Archiving puts it away, so any open tab for it closes too (unarchive leaves tabs alone).
// Shared by the kebab item and the archived view's row button.
export async function toggleArchiveFor(key: string): Promise<void> {
  const archived = new Map(Object.entries(await window.claudeUi.toggleArchive(key)));
  // One change, told once the tabs are closed, so the list draws with them gone, as it did.
  store.batch(() => {
    store.set({ archived });
    if (archived.has(key)) {
      hostOf('sessions').closeTabs(key);
    }
  });
}

// Pin or unpin one session, from its row.
export async function togglePinFor(key: string): Promise<void> {
  store.set({ pinned: new Set(await window.claudeUi.togglePin(key)) });
}

// Delete one session to the OS trash, once confirmed, from its row in the archived view.
export async function confirmAndDelete(key: string): Promise<void> {
  const session = currentByKey.get(key);
  const title = session ? sessionLabel(session) : key.slice(0, 8);
  if (!(await confirmDelete(title))) return;
  // Hide it right away so deletion feels instant; trashing files (slow under WSL) and the meta purge run in the background.
  // It stays hidden via pendingDeletes until its files are gone from disk (see fullRead), so a concurrent delete's re-read can't resurrect it.
  // Only this entity's file goes (entity key = session id); siblings are separate entities.
  store.set({ pendingDeletes: withMember(store.get().pendingDeletes, key, true) });
  try {
    // Guard against a delete that never settles (e.g. a hung OS-trash call): after 30s treat it as failed so the row can't stay hidden forever within a session.
    await Promise.race([
      window.claudeUi.deleteSession(key),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('delete timed out')), 30_000)),
    ]);
  } catch {
    showToast(`Couldn't delete "${title}". It's still here.`);
  } finally {
    // Stop hiding once this delete resolves: on success the re-read finds it gone; on failure the file is still on disk, so the row reappears.
    await fullRead({ showLoading: false, revealed: key });
  }
}

// The per-session action list — one builder, shared by the kebab on the session's row, its tab and its strip row, and opened from `from`.
// Every press on the session's row or strip row is here too, and the tab's button, dot and middle-click, and its select while that starts it, so a button is a shortcut to an item; the row and the tab leave out the item that would be themselves.
export function sessionMenuItems(session: SessionSummary, from: SessionSurface): MenuItem[] {
  // Opening can start claude in the session's folder, and forking always does, so both need that folder to be there — but the items stay in the list, dimmed and carrying the reason, rather than vanishing.
  // Everything below is bookkeeping about a session rather than a way to start one, so it stays available: cleaning up after a folder that has gone is exactly when you need it.
  const cannotRun = unstartableReason(session);
  const items: MenuItem[] = [
    // What the session is, before what can be done to it, so the tab's and the strip's kebab, which this builder fills too, show what their own surface has no room for.
    sessionHeader(session, store.get()),
    { label: '', separator: true },
  ];
  // An archived session's menu holds its siblings, its PRs and its note, as its row's marks in the archived view reach them, its id, and the archived view's two actions; nothing that starts or files it, which that view does not offer.
  if (store.get().archived.has(entityKey(session))) {
    return [
      ...items,
      ...linkedItems(session),
      noteItem(session),
      copyIdItem(session),
      { label: '', separator: true },
      { label: 'Unarchive', onSelect: () => void toggleArchiveFor(entityKey(session)) },
      { label: 'Delete session…', onSelect: () => void confirmAndDelete(entityKey(session)) },
    ];
  }
  // What a press on the row or the strip row does, each its own: the row opens the tab where you are, the strip row takes you to it.
  // On the tab only while nothing runs behind it and nothing is starting, cold or paused, where selecting it is what starts it; a running tab is already the session, a press away.
  const tab = tabWith(session.id);
  if (from !== 'tab' || (tab?.terminalId === null && !tab.starting)) {
    const open = from === 'strip' ? () => hostOf('sessions').openSession(session.id) : () => hostOf('sessions').openTab(session.id);
    items.push(cannotRun ? { label: 'Open', disabled: cannotRun } : { label: 'Open', onSelect: open });
  }
  // Not on the row, which is what it shows.
  if (from !== 'row') items.push({ label: 'Show in list', onSelect: () => showInList(session) });
  items.push(
    cannotRun
      ? { label: 'Fork this session', disabled: cannotRun }
      : { label: 'Fork this session', onSelect: () => { void hostOf('sessions').forkSession(session.id); } },
  );
  items.push(...linkedItems(session));
  // "in list" on every surface, the row's too: a pin says where a session sits in the list, which neither the tab bar nor the strip honours.
  const pinned = store.get().pinned.has(entityKey(session));
  items.push({ label: pinned ? 'Unpin' : 'Pin in list', onSelect: () => void togglePinFor(entityKey(session)) });
  // What a click on its dot does, by the same rule (`canMarkRead`), and unavailable where the click would do nothing.
  const markLabel = store.get().acked.has(session.id) ? 'Mark as unread' : 'Mark as read';
  items.push(
    canMarkRead(session.id)
      ? { label: markLabel, onSelect: () => toggleAck(session.id) }
      : { label: markLabel, disabled: 'Only a session that is idle or waiting for you can be marked read or unread' },
  );
  items.push(noteItem(session));
  items.push({ label: 'Move to group', submenu: moveToGroupItems(session) });
  items.push(copyIdItem(session));
  // The state changes sit below a rule, away from the navigate/copy items.
  items.push({ label: '', separator: true });
  // Pausing is the tab's, and needs one: it marks the tab, and for a running session asks its claude to leave (pauseTab).
  // A paused tab's way out is Stop session, the running one's word, since both leave an ordinary stopped tab: here it takes the mark off and starts nothing (`stopPausedTab`) (user, 2026-10-20, replacing "Unpause").
  // Only once it rests paused (`isPaused`), as its dot says.
  // Not while it starts, which clears the mark when its process arrives: there is nothing to stop yet, so it is any starting tab's then.
  // Nor while its claude is leaving, from a pause or a stop: it then has only the force, the item below, named for what was asked (user, 2026-10-23), since a Pause would ask claude again, and another pair of presses ends what claude asks on its way out unanswered.
  if (tab && isPaused(tab) && !tab.starting) items.push({ label: tabButtonLabel('stop'), onSelect: () => hostOf('sessions').stopPausedSession(session.id) });
  else if (tab?.starting) items.push({ label: 'Pause', disabled: 'Starting…' });
  else if (tab && !tab.stopping) items.push({ label: 'Pause', onSelect: () => hostOf('sessions').pauseSession(session.id) });
  // A press on the tab's button, from wherever the session's menu is, by the button's own rule (`tabButtonState`), so the item says and does what the button would: stop it, force it out, or close the tab it left.
  // What it says is what it does, or nothing, once the tab has moved on (`pressTabButton`).
  // Unavailable without a tab, since there is then nothing to stop or close.
  const button = tab ? tabButtonState(tab) : null;
  if (!button) items.push({ label: tabButtonLabel('close'), disabled: 'Not open in a tab' });
  else items.push(button.disabled ? { label: button.label, disabled: button.tooltip } : { label: button.label, onSelect: () => hostOf('sessions').pressTabButton(session.id, button.mark) });
  // Not while it runs, starting and stopping included: stopping it first, with the item above, keeps the tab up for anything claude asks on its way out, so Archive is never offered for a running tab.
  // A tab that is open but not running closes as the session is archived (`toggleArchiveFor`).
  const running = tab !== undefined && (tab.terminalId !== null || tab.starting);
  items.push(running ? { label: 'Archive', disabled: 'Stop the session first' } : { label: 'Archive', onSelect: () => void toggleArchiveFor(entityKey(session)) });
  return items;
}

// A session's siblings and PRs, each a submenu where it has any; the session's menu has them in both views.
// Here as well as on the row's marks: this list is every kebab's, the tab's and the live strip's too, where the row's marks are not.
function linkedItems(session: SessionSummary): MenuItem[] {
  const items: MenuItem[] = [];
  const siblings = siblingsOf(session);
  if (siblings.length > 0) items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
  if (session.prs.length > 0) items.push({ label: `PRs (${session.prs.length})`, submenu: prMenuItems(session) });
  return items;
}

function noteItem(session: SessionSummary): MenuItem {
  return { label: store.get().notes.has(entityKey(session)) ? 'Edit note…' : 'Add note…', onSelect: () => void editNote(session) };
}

// The short id shows here rather than on the row: this is where you come looking for it, and the item both displays it and copies the full one.
function copyIdItem(session: SessionSummary): MenuItem {
  return { label: `Copy session id (${session.id.slice(0, 8)})`, onSelect: () => void copyText(session.id, 'Session id copied.') };
}

// Bring a session's row into view, widening the list to All first when it shows another project.
// All rather than the session's project: choosing a project moves the tab bar and the tab on show with it, which would take you out of the tab you are in, while All holds every tab, so the one on show stays.
// The list can still leave the session out, and the toast says why where the store says it, rather than the press seeming to do nothing: under a filter, or not, such as one being deleted.
// Never for being archived: an archived session's menu has no Show in list on any surface (its own branch in `sessionMenuItems`).
function showInList(session: SessionSummary): void {
  const { activeProject } = store.get();
  if (activeProject !== null && activeProject !== session.repoRoot) hostOf('sessions').selectProject(null);
  if (revealSession(session)) return;
  const title = sessionLabel(session);
  if (isFiltering(store.get())) showToast(`"${title}" is left out by the filter. Clear it to see its row.`);
  else showToast(`"${title}" is not in the list.`);
}

// Open the note editor for a session.
// Saving a blank note clears it (meta drops the entry), so the same dialog both writes and removes one — there is no separate delete.
export async function editNote(session: SessionSummary): Promise<void> {
  const key = entityKey(session);
  const text = await promptText('Note', sessionLabel(session), store.get().notes.get(key) ?? '', 'Save', undefined, true);
  if (text === null) return; // cancelled: leave whatever was there
  store.set({ notes: new Map(Object.entries(await window.claudeUi.setNote(key, text))) });
}

// List a session's siblings in the shared popover; click one to jump to it.
export function openSiblingsMenu(anchor: HTMLElement, session: SessionSummary): void {
  const siblings = siblingsOf(session);
  // The mark can briefly outlive its siblings (a delete between refreshes); nothing to list then.
  if (siblings.length === 0) return;
  openMenu(anchor, siblingMenuItems(siblings));
}

// List a session's PRs in the shared popover; click one to open it.
export function openPrsMenu(anchor: HTMLElement, session: SessionSummary): void {
  if (session.prs.length === 0) return;
  openMenu(anchor, prMenuItems(session));
}

// A project's ordering moves, among the projects on screen.
// The order holds projects the list does not show, such as one whose sessions are all deleted, so a move steps over those and the ends are the ends of what is on screen (`movedProject`): moving a slot at a time, a project put in front of such a one swapped with it and seemed not to move.
export function projectMoveItems(repoRoot: string): MenuItem[] {
  const state = store.get();
  // All view only: a project view renders a single heading, so there is nothing to order against.
  if (state.activeProject !== null) return [];
  // Not while filtering either: where it would land among the projects the filter hides is arbitrary, so moves wait until the filter is cleared.
  if (isFiltering(state)) return [];
  // The projects the list has drawn that have a place in the order.
  // One that turned up since the last full read has none until that read gives it one, and is drawn last meanwhile wherever it is moved, so it offers no move, and the project above it no move down.
  const shown = renderedSections.projects.filter((root) => state.projectOrder.includes(root));
  return orderMoveItems(shown.indexOf(repoRoot), shown.length, (move) => moveProjectBy(repoRoot, move, shown));
}

// The list, the strip and the tab bar place projects by the order, so all three follow the store together rather than the bar at the next unrelated redraw.
async function moveProjectBy(repoRoot: string, move: OrderMove, shown: string[]): Promise<void> {
  store.set({ projectOrder: await window.claudeUi.moveProject(repoRoot, move, shown) });
}

export async function renameProject(repoRoot: string): Promise<void> {
  const name = await promptText('Rename project', repoRoot, projName(repoRoot, store.get()));
  if (name === null) return;
  // Typing the folder name back clears the override rather than storing a redundant one.
  const canonical = name.trim() === folderName(repoRoot) ? '' : name;
  store.set({ projectNames: new Map(Object.entries(await window.claudeUi.setProjectName(repoRoot, canonical))) });
}
