import type { OrderMove, SessionSummary } from '../../../../shared/types';
import { confirmDelete, promptText } from '../../../dialogs';
import { entityKey, folderName, relativeTime, sessionLabel, unstartableReason } from '../../../logic';
import { openMenu, type MenuItem } from '../../../menu';
import { store, withMember } from '../../../state/app';
import { applyGroupState, moveSessionToGroup } from '../../../state/groups';
import { isFiltering, projName, projectGroups } from '../../../state/views';
import { showToast } from '../../../toast';
import { hostOf } from '../builtin';
import { currentByKey, renderedSections } from './drawn';
import { fullRead } from './read';
import { revealGroup } from './reveal';

/**
 * THE SESSION LIST'S MENUS AND THE WRITES THEY MAKE: a session's options and its pin, archive and delete; a group's and a project's options, their moves and renames, and a new group.
 * Each write goes through main and is set in the store, which the list follows; nothing here draws the list.
 */

/** A heading's options: its ordering moves first, above a rule when it has any, then its own. */
export function withMoves(moves: MenuItem[], own: MenuItem[]): MenuItem[] {
  return [...moves, ...(moves.length > 0 ? [{ label: '', separator: true }] : []), ...own];
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
function siblingMenuItems(siblings: SessionSummary[]): MenuItem[] {
  return siblings.map((sibling) => ({
    label: `${sessionLabel(sibling)} · ${relativeTime(sibling.lastActivity)}`,
    onSelect: () => hostOf('sessions').openSession(sibling.id),
  }));
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

// The per-session action list — one builder, shared by the row kebab (and any future surface that offers session actions, e.g. a tab context menu).
export function sessionMenuItems(session: SessionSummary): MenuItem[] {
  // Forking RUNS claude in the session's folder, so it needs that folder to be there — but the item stays in the list, dimmed and carrying the reason, rather than vanishing.
  // Everything below is bookkeeping about a session rather than a way to start one, so it stays available: cleaning up after a folder that has gone is exactly when you need it.
  const cannotRun = unstartableReason(session);
  const items: MenuItem[] = [
    cannotRun
      ? { label: 'Fork this session', disabled: cannotRun }
      : { label: 'Fork this session', onSelect: () => { void hostOf('sessions').forkSession(session.id); } },
  ];
  const siblings = siblingsOf(session);
  if (siblings.length > 0) {
    items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
  }
  items.push({ label: store.get().notes.has(entityKey(session)) ? 'Edit note…' : 'Add note…', onSelect: () => void editNote(session) });
  items.push({ label: 'Move to group', submenu: moveToGroupItems(session) });
  // The short id shows here rather than on the row: this is where you come looking for it, and the item both displays it and copies the full one.
  items.push({
    label: `Copy session id (${session.id.slice(0, 8)})`,
    onSelect: () => void copyText(session.id, 'Session id copied.'),
  });
  // The state changes sit below a rule, away from the navigate/copy items.
  // Only the normal view offers them: the archived view keeps unarchive on the row and hides the kebab.
  items.push({ label: '', separator: true });
  // Stopping lives on the tab's own button, which is where the session you want to stop is: see closeOrStop.
  items.push({ label: 'Archive', onSelect: () => void toggleArchiveFor(entityKey(session)) });
  return items;
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

// A project's ordering moves.
// The order spans every project ever seen, so the ends are the ends of THAT list, not of what's on screen (a filter or an all-archived project can hide neighbours without changing where this one sits).
export function projectMoveItems(repoRoot: string): MenuItem[] {
  const state = store.get();
  const { activeProject, projectOrder } = state;
  // All view only: a project view renders a single heading, so there is nothing to order against.
  if (activeProject !== null) return [];
  // Not while filtering either: a hidden neighbour makes the move land where you can't see it, so "Move up" past a filtered-out project looks like a button that did nothing.
  if (isFiltering(state)) return [];
  return orderMoveItems(projectOrder.indexOf(repoRoot), projectOrder.length, (move) => moveProjectBy(repoRoot, move));
}

// The list, the strip and the tab bar place projects by the order, so all three follow the store together rather than the bar at the next unrelated redraw.
async function moveProjectBy(repoRoot: string, move: OrderMove): Promise<void> {
  store.set({ projectOrder: await window.claudeUi.moveProject(repoRoot, move) });
}

export async function renameProject(repoRoot: string): Promise<void> {
  const name = await promptText('Rename project', repoRoot, projName(repoRoot, store.get()));
  if (name === null) return;
  // Typing the folder name back clears the override rather than storing a redundant one.
  const canonical = name.trim() === folderName(repoRoot) ? '' : name;
  store.set({ projectNames: new Map(Object.entries(await window.claudeUi.setProjectName(repoRoot, canonical))) });
}
