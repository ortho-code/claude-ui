import { prReference } from '../../../../shared/prs';
import type { OrderMove, SessionSummary } from '../../../../shared/types';
import { confirmDanger, confirmDelete, promptText } from '../../../dialogs';
import { clockLines, clockOf, entityKey, folderName, leaveAction, leaveLabel, relativeTime, sessionLabel, setAsideUntil, unstartableReason, type LeaveAction } from '../../../logic';
import { openMenu, type MenuItem } from '../../../menu';
import { verdictOf } from '../../../prstatus';
import { store, type TabState } from '../../../state/app';
import { startBulk } from '../../../state/bulk';
import { applyGroupState, moveSessionsToGroup } from '../../../state/groups';
import { pickCheckout, pickedFor } from '../../../state/picks';
import { clearSetAside, markSetAside } from '../../../state/setaside';
import { clearNeedsYou } from '../../../state/needsyou';
import { canMarkRead, toggleAck } from '../../../state/statuses';
import { setAsideDialog } from '../../../setasidedialog';
import { isFiltering, leaveTab, projName, projectGroups, sessionById, sessionStarting, tabWith, unopenableReason } from '../../../state/views';
import { copyText, showToast } from '../../../toast';
import type { SessionSurface } from '../../contract';
import { hostOf } from '../builtin';
import { sessionHeader } from './describe';
import { currentByKey, renderedSections } from './drawn';
import { fullRead } from './read';
import { revealGroup, revealSession } from './reveal';
import '../../../tone.css';
import '../../../prstatus.css';

/**
 * THE SESSION LIST'S MENUS AND THE WRITES THEY MAKE: a session's options and its pin, finish and delete; a group's and a project's options, their moves and renames, and a new group.
 * Each write goes through main and is set in the store, which the list follows; nothing here draws the list.
 */

/** A heading's options: its own, then its ordering moves last of all, below a rule when it has any (decided 2026-10-20). */
export function withMoves(moves: MenuItem[], own: MenuItem[]): MenuItem[] {
  return [...own, ...(moves.length > 0 ? [{ label: '', separator: true }] : []), ...moves];
}

// --- Session helpers ---

// A session's siblings (the other members of its family), most recent first.
// Shared by the count badge and the kebab submenu.
function siblingsOf(session: SessionSummary): SessionSummary[] {
  return store
    .get()
    .sessions.filter((s) => session.siblingIds.includes(s.id))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Menu items for a sibling list; siblings often share a title, so each shows title + when.
// One that cannot be opened, a finished one say, stays in the list, unavailable and saying why (`unopenableReason`).
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

// The checkouts a session worked in (`SessionSummary.checkouts`), as a pick-one list of where the panels look for it, under a line saying so, since nothing else in a session's menu moves the panels: "Follow the session" first, ticked while nothing is picked, then each checkout, newest change first, by its folder's name, as a panel's header names it, and when the session last changed a file there; the worktree its mark names says where the session is instead, where it changed nothing.
// A pick is the session's (`pickCheckout`), so it is made alike from every surface, a tab or none, and holds while the session is on show; a gone checkout has nothing to look at, so it stays in the list, unavailable and saying why.
// Shared by the worktree mark and the kebab submenu.
function worktreeItems(session: SessionSummary): MenuItem[] {
  const picked = pickedFor(session);
  const checkouts = session.checkouts.map(({ root, at, gone }): MenuItem => ({
    label: `${folderName(root)} · ${at ? relativeTime(at) : session.worktree ? 'runs here' : 'left'}`,
    checked: root === picked,
    ...(gone ? { disabled: 'Its folder is gone' } : { onSelect: () => pickCheckout(session.id, root) }),
  }));
  return [
    // The first line short, since a menu cuts it when too long for it; the line under it wraps.
    { label: 'Where the panels look', header: ['A pick holds them there until you follow the session again'] },
    { label: 'Follow the session', checked: picked === '', onSelect: () => pickCheckout(session.id, '') },
    { label: '', separator: true },
    ...checkouts,
  ];
}

// --- Group actions ------------------------------------------------------------------------------ Written through main, which hands back the whole state (state/groups.ts).

// Name a new group, create it in the project, and take the list to it.
// From a row it moves that session in at the same time, so the group is never briefly empty and the user never has to find it again to fill it; from the project heading it starts empty, to be filled from its own "+" or a row's "Move to group".
// A new group lands at the top of its project, which can be well away from the row or heading it was made from, so the jump — unfolding the project if it is folded — and its flash show where it went.
// A filter hides empty groups, so one made empty under a filter is not drawn, and the toast says where it went instead.
// From the bar of selecting several, it moves every ticked session in: the first as the group is made, the rest in one more write.
export async function promptNewGroup(repoRoot: string, sessionIds: readonly string[] = []): Promise<void> {
  const name = await promptText('New group', projName(repoRoot, store.get()), '', 'Create');
  if (!name?.trim()) return;
  const known = new Set(store.get().groupState.groups.map((g) => g.id));
  applyGroupState(await window.claudeUi.createGroup(name, repoRoot, sessionIds[0]));
  // The list has drawn the answer by now: the store tells as it is set.
  const group = store.get().groupState.groups.find((g) => !known.has(g.id));
  if (!group) return;
  if (sessionIds.length > 1) await moveSessionsToGroup(sessionIds.slice(1), group.id);
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

// The "Move to group" list, for one session from its menu or several from the bar of selecting several, all of one project: the project's groups, the one they are all in ticked, then the two ways out — back to the project, or into a group that doesn't exist yet.
export function moveToGroupItems(sessions: readonly SessionSummary[]): MenuItem[] {
  const state = store.get();
  const repoRoot = sessions[0]?.repoRoot ?? '';
  const keys = sessions.map(entityKey);
  const currents = new Set(keys.map((key) => state.groupState.groupOf[key] ?? null));
  // The group every one is in, null for none, undefined when they are in different ones and nothing is ticked.
  const current: string | null | undefined = currents.size === 1 ? [...currents][0] : undefined;
  const items: MenuItem[] = projectGroups(repoRoot, state).map((group) => ({
    label: group.name,
    checked: group.id === current,
    onSelect: () => void moveSessionsToGroup(keys, group.id),
  }));
  if (items.length > 0) items.push({ label: '', separator: true });
  items.push({ label: 'None', checked: current === null, onSelect: () => void moveSessionsToGroup(keys, null) });
  items.push({ label: 'New group…', onSelect: () => void promptNewGroup(repoRoot, keys) });
  return items;
}

// Make one session unfinished, leaving tabs alone: from the finished view's row button and the finished session's menu.
export async function unfinishFor(key: string): Promise<void> {
  store.set({ finished: new Map(Object.entries(await window.claudeUi.unfinish([key]))) });
}

// Pin or unpin one session, from its row.
export async function togglePinFor(key: string): Promise<void> {
  store.set({ pinned: new Set(await window.claudeUi.togglePin(key)) });
}

/**
 * Delete sessions to the OS trash, once confirmed, one question for all of them: from a finished row's button or menu, one, and from the bar of selecting several in the finished view, every one ticked.
 * Only these entities' files go (entity key = session id); siblings are separate entities.
 */
export async function confirmAndDelete(keys: readonly string[]): Promise<void> {
  const titles = keys.map((key) => {
    const session = currentByKey.get(key);
    return session ? sessionLabel(session) : key.slice(0, 8);
  });
  if (keys.length === 0) return;
  const asked = keys.length === 1 ? confirmDelete(titles[0]!) : confirmDanger(`Delete ${keys.length} sessions?`, 'Their transcript files move to the trash, so you can restore them from there if needed.', 'Delete');
  if (!(await asked)) return;
  // Hide them right away so deletion feels instant; trashing files (slow under WSL) and the meta purge run in the background.
  // They stay hidden via pendingDeletes until their files are gone from disk (see fullRead), so a concurrent delete's re-read can't resurrect them.
  store.set({ pendingDeletes: new Set([...store.get().pendingDeletes, ...keys]) });
  // Guard against a delete that never settles (e.g. a hung OS-trash call): after 30s treat it as failed so a row can't stay hidden forever within a session.
  const results = await Promise.allSettled(
    keys.map((key) => Promise.race([window.claudeUi.deleteSession(key), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('delete timed out')), 30_000))])),
  );
  const failed = results.flatMap((result, i) => (result.status === 'rejected' ? [titles[i]!] : []));
  if (failed.length === 1) showToast(`Couldn't delete "${failed[0]!}". It's still here.`);
  else if (failed.length > 1) showToast(`Couldn't delete ${failed.length} sessions. They're still here.`);
  // Stop hiding once the deletes resolve: on success the re-read finds them gone; on failure the files are still on disk, so the rows reappear.
  await fullRead({ showLoading: false, revealed: keys });
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
  // A finished session's menu holds its siblings, its PRs, its worktrees, its scheduled tasks and its note, as its row's marks in the finished view reach them, its id, and the finished view's two actions, and on its row Select…; nothing that starts or files it, which that view does not offer.
  if (store.get().finished.has(entityKey(session))) {
    return [
      ...items,
      ...linkedItems(session),
      noteItem(session),
      copyIdItem(session),
      { label: '', separator: true },
      { label: 'Unfinished', onSelect: () => void unfinishFor(entityKey(session)) },
      { label: 'Delete session…', onSelect: () => void confirmAndDelete([entityKey(session)]) },
      // Selecting several starts in the list, so only its row offers it (docs/architecture.md § Selecting several).
      ...(from === 'row' ? [{ label: 'Select…', onSelect: () => startBulk([entityKey(session)]) }] : []),
    ];
  }
  // What a press on the row or the strip row does, each its own: the row opens the tab where you are, the strip row takes you to it.
  // On the tab only while nothing runs behind it and nothing is starting, cold, where selecting it is what starts it; a running tab is already the session, a press away.
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
      : { label: markLabel, disabled: 'Only a session that is idle, waiting for you or marked as needing you can be marked read or unread' },
  );
  // Settling the needs-you mark without acting on the session, which a prompt there, a close and a finish also do; reading it only dims it (decided 2026-10-28).
  items.push(
    store.get().needsYou.has(entityKey(session))
      ? { label: 'Clear needs you', onSelect: () => clearNeedsYou(entityKey(session), 'cleared') }
      : { label: 'Clear needs you', disabled: 'Not marked as needing you' },
  );
  // Setting it aside is a mark on the session, with a tab or without, running or not, and leaves the tab as it is (decided 2026-10-29).
  items.push(...setAsideItems(session));
  items.push(noteItem(session));
  items.push({ label: 'Move to group', submenu: moveToGroupItems([session]) });
  items.push(copyIdItem(session));
  // Selecting several starts in the list, so only its row offers it, with that row ticked (docs/architecture.md § Selecting several).
  if (from === 'row') items.push({ label: 'Select…', onSelect: () => startBulk([entityKey(session)]) });
  // The state changes sit below a rule, away from the navigate/copy items.
  items.push({ label: '', separator: true });
  // Stop session, Close tab and Finished, each one press of its own meaning, whatever the tab is doing (decided 2026-10-28), by the rule the tab's button is a shortcut to (`leaveAction`).
  items.push(leaveItem(session, tab, 'stop'));
  items.push(leaveItem(session, tab, 'close'));
  // Finished is the session's rather than a tab's (`finishSessions`): a session with no tab finishes at once, and one with a tab starting is unavailable, whichever tab it is, since there is no claude yet to ask to leave (`leaveAction`, as the tab's button says it).
  const key = entityKey(session);
  if (tab) items.push(leaveItem(session, tab, 'finish'));
  else if (sessionStarting(key)) items.push({ label: leaveLabel('finish'), disabled: 'Starting…' });
  else items.push({ label: leaveLabel('finish'), onSelect: () => hostOf('sessions').finishSessions([key]) });
  return items;
}

// A leave item of the session's menu, by the rule its tab's button follows (`leaveAction`): what it says is what it does, or nothing, once the tab has moved on (`pressLeave`).
// Unavailable without a tab, since there is then nothing to stop or close.
function leaveItem(session: SessionSummary, tab: TabState | undefined, action: LeaveAction): MenuItem {
  if (!tab) return { label: leaveLabel(action), disabled: 'Not open in a tab' };
  const item = leaveAction(leaveTab(tab), action);
  return item.disabled ? { label: item.label, disabled: item.tooltip } : { label: item.label, onSelect: () => hostOf('sessions').pressLeave(session.id, action, item.mark) };
}

// A session's siblings, PRs, the checkouts it worked in and what its clock says, each a submenu where it has any; the session's menu has them in both views.
// Here as well as on the row's marks: this list is every kebab's, the tab's and the live strip's too, where the row's marks are not.
function linkedItems(session: SessionSummary): MenuItem[] {
  const items: MenuItem[] = [];
  const siblings = siblingsOf(session);
  if (siblings.length > 0) items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
  if (session.prs.length > 0) items.push({ label: `PRs (${session.prs.length})`, submenu: prMenuItems(session) });
  if (session.checkouts.length > 0) items.push({ label: `Worktrees (${session.checkouts.length})`, submenu: worktreeItems(session) });
  // The clock opens nothing, so its tasks are lines to read in its own words (`header`), not items to press.
  const clock = clockLines(clockOf(store.get().scheduledTasks.get(session.id), tabWith(session.id)));
  if (clock) {
    const [heading, ...tasks] = clock;
    items.push({ label: `Scheduled (${tasks.length})`, submenu: [{ label: heading!, header: tasks }] });
  }
  return items;
}

/**
 * Set aside…, which asks when it comes back as needing you and where it stands, and Clear set aside: a mark on the session, so the tab is left as it is (decided 2026-10-29).
 * A finished session's menu has neither, since a finish clears the mark.
 */
function setAsideItems(session: SessionSummary): MenuItem[] {
  const key = entityKey(session);
  return [
    // No toast: the row stays where it was, its bookmark saying what was done; the bar's batch has one, since its rows can leave the list (decided 2026-11-04).
    { label: 'Set aside…', onSelect: () => void askSetAside([key], sessionLabel(session)) },
    store.get().setAside.has(key) ? { label: 'Clear set aside', onSelect: () => clearSetAside([key]) } : { label: 'Clear set aside', disabled: 'Not set aside' },
  ];
}

/**
 * Set sessions aside through Set aside…, one act for a session's menu and the bar of selecting several: `what` names them in its title, a session's title or a count.
 * One session's dialog holds its note as where it stands, and the note is written when it changed; several leave their notes as they are (decided 2026-11-05).
 * Resolves, once written, to the moment chosen and an Undo that puts back each mark and the note as they were, or to null when the dialog was cancelled.
 */
export async function askSetAside(keys: readonly string[], what: string): Promise<{ due: number | null; undo: () => void } | null> {
  const { setAside, notes } = store.get();
  const [only] = keys;
  const one = keys.length === 1 ? only : undefined;
  const note = one === undefined ? null : (notes.get(one) ?? '');
  const answer = await setAsideDialog({ what, mark: one === undefined ? undefined : setAside.get(one), note });
  if (!answer) return null;
  const before = new Map(keys.map((key) => [key, store.get().setAside.get(key)]));
  markSetAside(keys, answer.due);
  const noteChanged = one !== undefined && answer.note !== null && answer.note !== note;
  if (noteChanged) await writeNote(one, answer.note!);
  return {
    due: answer.due,
    undo: () => {
      clearSetAside(keys.filter((key) => before.get(key) === undefined));
      for (const [key, mark] of before) if (mark) markSetAside([key], mark.due, mark.at);
      if (noteChanged) void writeNote(one, note!);
    },
  };
}

/**
 * Set aside… for sessions that leave what is on show, the bar's ticked rows or the tabs a close removed: `askSetAside` naming them by the one's title or how many, and what the toast that follows says, "Set "OAuth scopes" aside until Fri 6 Nov, 09:00", with its Undo; null when cancelled.
 */
export async function setAsideNamed(keys: readonly string[]): Promise<{ said: string; undo: () => void } | null> {
  const [only] = keys;
  const session = only !== undefined && keys.length === 1 ? sessionById(only) : undefined;
  const done = await askSetAside(keys, session ? sessionLabel(session) : `${keys.length} sessions`);
  if (!done) return null;
  return { said: `Set ${session ? `"${sessionLabel(session)}"` : `${keys.length} sessions`} aside${setAsideUntil(done.due)}`, undo: done.undo };
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
// Never for being finished: a finished session's menu has no Show in list on any surface (its own branch in `sessionMenuItems`).
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
  // The session in the title, as Set aside… has it, and the line under it says where the note shows and how it goes (decided 2026-10-29).
  const text = await promptText(`Note: ${sessionLabel(session)}`, 'Shown when you hover the note mark on its row; save it empty to remove it.', store.get().notes.get(key) ?? '', 'Save', undefined, true);
  if (text === null) return; // cancelled: leave whatever was there
  await writeNote(key, text);
}

/** Write a session's note, a blank one removing it, and set what main hands back. */
async function writeNote(key: string, text: string): Promise<void> {
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

// List the checkouts a session worked in in the shared popover.
export function openWorktreesMenu(anchor: HTMLElement, session: SessionSummary): void {
  if (session.checkouts.length === 0) return;
  openMenu(anchor, worktreeItems(session));
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
