// The bundle's stylesheets come in the order of these imports: what every module draws with, then the services' and the panel tree's own, then the rules no module has taken yet, which build on all of them.
import './base.css';
// The services the sidebar's list draws with are imported here for their stylesheets' place in that order, ahead of every panel.
import './menu';
import './unavailable';
import { hideToast, showToast } from './toast';
import { showAttentionToast } from './notifications';
import { promptText } from './dialogs';
import { openSettings } from './settings';
import './projectgone';
import { startChrome } from './chrome';
import './flash';
import { initTree, loadLayout, startPanels, restoreTreeState, treeState, treeContextChanged, treeSessionsChanged } from './panels/tree';
import { railStatusFollowsTabs } from './panels/types/claude/index';
import { history, paneFollows } from './panels/types/claude/pane';
import {
  activateTab,
  closeTab,
  createTab,
  persistOpenTabs,
  reconcileOpenTabs,
  restoreOpenTabs,
  setTab,
  startTab,
  stopSession,
  switchWorkspaceTerminal,
  tabOf,
  type TabLaunch,
} from './panels/types/claude/terminals';
import { renderTabBar, tabBarFollowsStatuses } from './panels/types/claude/tab-bar';
import { fallBackIfEmptied, refreshSwitcher, selectProject } from './panels/types/sessions/switcher';
import { refreshStrip } from './panels/types/sessions/attention-strip';
import { applyDatePickerMinDate, filterPanelFollows, restoreFilter } from './panels/types/sessions/filter';
import {
  container,
  dotsFollowStatuses,
  jumpToGroup,
  listChanged,
  listFollowsTabs,
  renderList,
  renderSessions,
  revealProjectInSidebar,
  revealSessionInSidebar,
} from './panels/types/sessions/list';
import './styles.css';
import { store, withEntry, type StoredView, type View } from './state/app';
import { isFiltering, projName, sessionById, tabOnShow, tabWith } from './state/views';
import { setStatus } from './state/statuses';
import { applyGroupState, moveSessionToGroup } from './state/groups';
import { newSession, untitledLabel } from './newsession';
import type { SessionSummary, UiState } from '../shared/types';
import { entityKey, unstartableReason, sessionLabel } from './logic';
import { installTooltips } from './tooltip';
import { strokeIcon } from './svg';
import { routeTerminals } from './terminal';
import { hostOf } from './panels/types/builtin';

const newButton = document.getElementById('new-session') as HTMLButtonElement;

// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;

/** The statuses as the toasts last saw them, so only a change of state is news. */
let toastedStatuses: View<'statuses'>['statuses'] = new Map();

/**
 * A real transition into waiting/idle on a tab you're not looking at -> toast it. Never for busy, a cleared status, a no-op repeat, or the tab you're already on.
 * Start-up's read of every status toasts nothing: it lands before the tabs are restored, so no session in it has a tab yet.
 */
function toastAttention(view: View<'statuses' | 'tabs' | 'activeTab' | 'projectNames'>): void {
  const before = toastedStatuses;
  toastedStatuses = view.statuses;
  for (const [id, status] of view.statuses) {
    if ((status !== 'waiting' && status !== 'idle') || status === before.get(id)) continue;
    const tab = tabWith(id, view);
    if (!tab || tab.token === view.activeTab) continue;
    const { token } = tab;
    showAttentionToast({ status, label: sessionLabel(tab.session), project: projName(tab.session.repoRoot, view), open: () => jumpToTab(token) });
  }
}

// Jump to a tab from a toast: scope to its project if we're viewing a different one, then activate it.
function jumpToTab(token: string): void {
  const tab = tabOf(token);
  // Closed since the toast went up: there is nothing left to go to.
  if (!tab) return;
  const { activeProject } = store.get();
  if (activeProject !== null && activeProject !== tab.session.repoRoot) {
    hostOf('claude').selectProject(tab.session.repoRoot);
  }
  activateTab(token);
}

// A disk change fired: re-read sessions; the store tells the list and the tabs only when the structure actually changed (a new/removed session, a rename, or a new branch becoming the tip).
// Statuses and pins arrive on their own channels, so we don't refetch them here.
async function refreshFromDisk(): Promise<void> {
  store.set({ sessions: await window.claudeUi.listSessions() });
}

// --- View state that survives a restart ---
// Search, filters, folds, width and scroll are one answer to one question — put the sidebar back the way it was — so they are snapshotted, stored and restored together rather than as a setting each.

// Nothing is written until the start-up read has put the stored view back in the store (`startSavingUi`), or a save in between would write an empty sidebar straight over the real one.
let uiRestored = false;
let uiSaveTimer: number | undefined;
// The last snapshot actually sent. Renders happen for reasons that have nothing to do with the view — a transcript growing, a status dot changing — and without this each one would cost a full read-modify-write of meta.json.
let lastUiSignature = '';

function uiSnapshot(view: StoredView = store.get()): UiState {
  const { folds } = view;
  return {
    // The search as typed, not the trimmed and lowercased text it matches: what is restored has to be what was typed.
    ...view.filter,
    filterPanelOpen: view.filterPanelOpen,
    footerExpanded: view.footerExpanded,
    collapsedProjects: [...folds.projects],
    collapsedGroups: [...folds.groups],
    filterCollapsedProjects: [...folds.filterProjects],
    filterCollapsedGroups: [...folds.filterGroups],
    // Adopted into the layout tree's sizes on the first launch that has them, and not written again: the tree owns the sidebar's width now.
    sidebarWidth: null,
    scrollTop: container.scrollTop,
    panelState: treeState(),
  };
}

/**
 * Store the view, on a debounce: a watcher of the view's slices, and called by what the store does not hold — the list's scroll, and the layout tree's sizes, folds and picks.
 * Typing in the search box and dragging the scrollbar both change this state continuously, and every write is a read-modify-write of meta.json plus an audit line, so what is wanted is one write per pause rather than one per keystroke.
 */
function persistUi(): void {
  if (!uiRestored) return;
  if (uiSaveTimer !== undefined) clearTimeout(uiSaveTimer);
  uiSaveTimer = window.setTimeout(() => {
    uiSaveTimer = undefined;
    const state = uiSnapshot();
    const signature = JSON.stringify(state);
    if (signature === lastUiSignature) return;
    lastUiSignature = signature;
    window.claudeUi.setUiState(state);
  }, 400);
}

/**
 * Put the sidebar back the way it was left, and hand back what the start-up read sets in the store with the listing (`renderSessions`), and the scroll offset to apply once there is a list to scroll.
 *
 * Runs before the first render on purpose, and the view goes into the store in the same change as the listing: restoring filters afterwards would draw the full list and then visibly cut it down.
 * What is drawn straight from what was stored — the search box, the calendar, the chosen preset, the panel — is put back by the filter (`restoreFilter`), before the layout places the sidebar.
 * A deleted group's fold comes back too, and goes once the groups have been read (`forgetDeletedGroupFolds`).
 */
async function restoreUiState(): Promise<{ scrollTop: number; view: StoredView }> {
  const state = await window.claudeUi.getUiState();
  // The sidebar's width lived in localStorage, then in `sidebarWidth`; either is adopted once into the layout tree's sizes, so an existing install keeps its sidebar, and the tree owns it from here.
  restoreTreeState(state.panelState, state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth')));
  const filter = await restoreFilter(state);
  // The folds made under a filter apply only while it is on, so a filter stored off leaves them behind.
  const underFilter = isFiltering({ filter });
  const view: StoredView = {
    filter,
    folds: {
      projects: new Set(state.collapsedProjects),
      groups: new Set(state.collapsedGroups),
      filterProjects: new Set(underFilter ? state.filterCollapsedProjects : []),
      filterGroups: new Set(underFilter ? state.filterCollapsedGroups : []),
    },
    // Exactly as it was left, an active filter included. Closing the panel over a filter you have deliberately left on is a choice to keep the results and reclaim the space; a shut panel folds down to chips naming what is on, so the list never passes for the whole one.
    filterPanelOpen: state.filterPanelOpen,
    footerExpanded: state.footerExpanded,
  };
  // Seed the signature from what was just restored, so an opening render that changed nothing writes nothing.
  lastUiSignature = JSON.stringify(uiSnapshot(view));
  return { scrollTop: state.scrollTop, view };
}

/** From the start-up read on, the view in the store is the one you left, so it can be saved; anything asked for meanwhile — the layout dropping a stale split's sizes, say — is written now, if it changed anything. */
function startSavingUi(): void {
  uiRestored = true;
  persistUi();
}

/**
 * A project keeps its fold even while it has no sessions to show (same reasoning as the project order), but a DELETED group is gone for good.
 * The folds come back with the groups' first read, so the list's first draw is already the one you left; a fold of a group that is gone draws nothing meanwhile.
 */
function forgetDeletedGroupFolds({ groupState, folds }: View<'groupState' | 'folds'>): void {
  const live = new Set(groupState.groups.map((g) => g.id));
  const alive = (ids: ReadonlySet<string>): ReadonlySet<string> => new Set([...ids].filter((id) => live.has(id)));
  store.set({ folds: { ...folds, groups: alive(folds.groups), filterGroups: alive(folds.filterGroups) } });
}

// --- Session helpers ---

// Jump to a specific session from outside the list — the footer, a panel's row: scope to its project if needed, then open/focus its tab.
function jumpToSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const { activeProject } = store.get();
  const sidebar = hostOf('claude');
  if (activeProject !== null && activeProject !== session.repoRoot) sidebar.selectProject(session.repoRoot);
  void openSession(session, launch);
  // Scope alone isn't enough to SEE it: the row can sit inside a collapsed group or project.
  // Reveal the same way clicking a tab does — jumping to a sibling filed in another group is exactly the case where scoping to the project still leaves the row hidden.
  sidebar.revealSession(session.id);
}

settingsToggle.addEventListener('click', () => void openSettings());

// --- Tabs ---

/**
 * Open a session's tab, starting it when it is not running.
 * A first prompt is for a session that is NOT running, which starts with it — a resumed one included; one that is running is only brought into view, since typing into a live session is never the app's to do.
 */
async function openSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): Promise<void> {
  const existing = tabWith(session.id);
  if (existing) {
    if (existing.terminalId === null && launch.prompt) {
      activateTab(existing.token, false);
      await startTab(existing.token, launch);
      return;
    }
    activateTab(existing.token);
    return;
  }
  await createTab(session, launch);
}

// Land where a new tab will be visible: stay in its own project, else drop the scope to All.
// Only the scope: the new tab, which its caller creates next, is the one that comes on show.
function ensureProjectVisible(repoRoot: string): void {
  const { activeProject } = store.get();
  if (activeProject !== null && repoRoot !== activeProject) {
    store.set({ activeProject: null });
    window.claudeUi.setActiveProject(null);
  }
}

// Start a brand-new claude session in `cwd`, under an id this app mints; the sidebar row is that same session, filled in once claude writes its transcript.
// A panel's row starting one passes a name and a first prompt, and mints the id itself, so it can remember the session before the tab exists.
async function openNewSession(cwd: string, joinGroupId?: string, launch: Pick<TabLaunch, 'name' | 'prompt'> = {}, id: string = crypto.randomUUID()): Promise<void> {
  const session = newSession(id, { cwd, repoRoot: cwd, title: launch.name || untitledLabel(cwd) });
  // Filed BEFORE the tab exists, so the row's first paint is already inside the group. An ordinary membership write: the id is the session's real one, so there is nothing to correct afterwards.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: launch.name || undefined, prompt: launch.prompt || undefined });
}

/** Go to a session a panel's row started, as a jump from the attention strip does; one whose folder is gone says so, as its row in the list would. */
function openLinkedSession(id: string, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const session = sessionById(id);
  if (!session) return;
  const reason = unstartableReason(session);
  if (reason) {
    showToast(reason);
    return;
  }
  jumpToSession(session, launch);
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`.
// Prompts for an optional name (blank -> claude auto-names).
// Like openNewSession, the tab carries the session's real id from the start; the worktree badge is the only optimistic part, and it reconciles on the next refresh.
async function openWorktreeSession(repoRoot: string, joinGroupId?: string): Promise<void> {
  // claude's `-w` name must be a slug (letters/digits/dots/underscores/dashes); turn the free-text label into one. A blank slug means auto-name, which can't collide.
  const slugify = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const label = await promptText(
    'New worktree session',
    `Worktree of "${projName(repoRoot, store.get())}"`,
    '',
    'Create',
    // Validate in the dialog so a duplicate name is caught without closing it — claude -w would otherwise silently switch to the existing worktree instead of creating one.
    async (value) => {
      const s = slugify(value);
      return s && (await window.claudeUi.worktreeExists(repoRoot, s))
        ? `A worktree named "${s}" already exists in this project.`
        : null;
    },
  );
  if (label === null) return;
  const friendly = label.trim();
  // Pass the label as `--name` so the session still displays what was typed.
  const slug = slugify(friendly);
  const session = newSession(crypto.randomUUID(), {
    cwd: repoRoot,
    repoRoot,
    isRepo: true,
    // Show the worktree badge right away (optimistic); it reconciles to the real name on refresh.
    worktree: slug || 'new worktree',
    // The name you typed becomes the title (it's also what --name sets); the badge already says it's a worktree, so no prefix. Blank name falls back to a plain new-session label.
    title: friendly || untitledLabel(repoRoot),
  });
  // Same as openNewSession: filed before the tab exists, so the row never appears loose.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: friendly || undefined, worktree: slug });
}

// Fork an existing session: `claude --session-id <new> --resume <parent> --fork-session` copies its transcript into a new session in the same cwd.
// The fork's id is minted here like any other new session — claude honours it even while resuming — so the fork is a row of its own from the first paint, not one that arrives later.
async function forkSession(parent: SessionSummary): Promise<void> {
  const parentTitle = sessionLabel(parent, 'session');
  // Forks copy the parent's title, so offer a fresh name up front (via claude's --name). Cancel aborts the fork; keeping/clearing the field just inherits the parent title.
  const name = await promptText('Create fork', `Fork from "${parentTitle}"`, parentTitle, 'Fork');
  if (name === null) return;
  const trimmed = name.trim();
  const session = newSession(crypto.randomUUID(), {
    cwd: parent.cwd,
    repoRoot: parent.repoRoot,
    isRepo: parent.isRepo,
    worktree: parent.worktree,
    title: trimmed || parentTitle,
    // Mark it a family member right away (we know its parent is a sibling), so the row shows the sibling mark immediately instead of waiting for claude to write the transcript.
    // It reconciles to the real row once that file lands and grouping runs on the next refresh.
    isSibling: true,
    siblingIds: [parent.id],
  });
  ensureProjectVisible(session.repoRoot);
  // A fork continues its parent's work, so it belongs wherever the parent was filed — and it shows there immediately, like a new session started from the group's "+".
  const parentGroup = store.get().groupState.groupOf[entityKey(parent)];
  if (parentGroup) await moveSessionToGroup(session, parentGroup);
  await createTab(session, { resumeFrom: parent.id, fork: true, name: trimmed || undefined });
}

// --- Wiring ---

// Output and exits reach a tab through the sink it bound when it started (terminal.ts routes them by terminal id, for tabs and panels alike).
routeTerminals();

// --- What the store tells ---
// Subscribed before start-up sets anything, and told in this order.

// What the switcher's projects are made of changed, and the project on show may have none left: first, so everything after draws All rather than the empty project.
// The tabs are among them: a session with no transcript yet is in its project only through its tab.
store.watch(['sessions', 'archived', 'pendingDeletes', 'tabs'], fallBackIfEmptied, { reads: ['activeProject'] });

// The listing moved: the open tabs adopt their sessions' fresh summaries, before the list draws them, and the calendar's first day is the oldest session's.
store.watch(['sessions'], reconcileOpenTabs, { reads: ['tabs'] });
store.watch(['sessions'], applyDatePickerMinDate);

// Something the list draws changed — the listing, a model switch, a pin, the archive, a note, a delete in flight, the groups, a project's name or place, the project on show, the filter — and the list follows, with the filter's count and chips it draws.
// The list paints every dot it draws, but a status change repaints only the dots, below.
store.watch(
  ['sessions', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter'],
  listChanged,
  // The folds are read, never told: a heading's click folds in place without drawing the list, and whoever else folds draws it.
  { reads: ['statuses', 'acked', 'tabs', 'activeTab', 'folds', 'filterPanelOpen'] },
);

// A tab opened, started, stopped, closed or came on show: the rows' marks, and the list itself when what it draws from the tabs moved.
store.watch(['tabs', 'activeTab'], listFollowsTabs, {
  reads: ['sessions', 'statuses', 'acked', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter', 'folds', 'filterPanelOpen'],
});

// The filter panel opened or shut: it follows, with the chips that stand in for it while it is shut.
store.watch(['filterPanelOpen'], filterPanelFollows, { reads: ['filter'] });

// A status or a mark read changed: the rows' dots that differ.
store.watch(['statuses', 'acked'], dotsFollowStatuses);

// A tab not on show turned waiting or finished: a toast says so.
store.watch(['statuses'], toastAttention, { reads: ['tabs', 'activeTab', 'projectNames'] });

// The tab bar clusters its tabs by group, places its projects by the order under their names, and shows the project on show's tabs, as the list does: it follows the same changes, and every change to a tab or to which one is on show.
store.watch(['groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'], renderTabBar, { reads: ['sessions', 'statuses', 'acked'] });
// And a status or a mark read of one of its tabs' sessions.
store.watch(['statuses', 'acked'], tabBarFollowsStatuses, { reads: ['sessions', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'] });

// The switcher counts every project's sessions, rolls up their statuses and names the project on show; the sidebar's rail icon says what its badge says.
// A session with no transcript yet is in its project only through its tab, so the tabs are among what it counts.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'projectNames', 'projectOrder', 'activeProject', 'tabs'], refreshSwitcher);

// The strip lists what runs, in the bar's order, each row with a stop button in the tab's state, under a line badged with the switcher's roll-up; it shows those rows or folds to its line as you left it.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'tabs', 'footerExpanded'], refreshStrip);

// The terminal area's rail icon waits while a tab on show waits for you.
store.watch(['activeProject', 'tabs', 'statuses', 'acked'], railStatusFollowsTabs);

// The pane shows the tab on show, or says why there is none, which turns on the listing and the project on show too.
store.watch(['sessions', 'activeProject', 'tabs', 'activeTab'], paneFollows);

// The view you are leaving behind — the filter, the folds, the panel, the strip — is kept for the next launch; the snapshot is compared before it is written, so a change that ends where it began costs nothing.
store.watch(['filter', 'folds', 'filterPanelOpen', 'footerExpanded'], () => persistUi());

// The panels run where you are: in the tab on show's folder, or without one in the project's root, or in nothing in the All view.
store.watch(['activeProject', 'activeTab'], treeContextChanged);

// A panel's rows mark the sessions they started — each one's title, status dot, mark read, and whether it runs — so the panels hear of every change to those, and to which sessions a panel's rows started (its data, panels/links.ts).
store.watch(['sessions', 'statuses', 'acked', 'tabs', 'panelData'], treeSessionsChanged);

window.claudeUi.onSessionStatus((id, status, tabToken) => {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tabToken ? tabOf(tabToken) : undefined;
  if (owner && owner.session.id !== id) {
    const previous = owner.session;
    const replaced = previous.id;
    // A CLEARED SESSION IS A NEW SESSION, so it starts from the same blank the "+" button does rather than from its predecessor's row.
    // Carrying the old object forward was the app's own half of the copied-title problem: it kept the title, the first message and the sibling marks of a conversation this session does not have.
    // The folder is all that genuinely survives — it is the same terminal, in the same place.
    // Everything that draws the tab follows: the bar names the new session, its stand-in row is the open one, and the history on show follows it, since a cleared session has a transcript of its own.
    setTab(owner.token, {
      session: newSession(id, {
        cwd: previous.cwd,
        repoRoot: previous.repoRoot,
        isRepo: previous.isRepo,
        worktree: previous.worktree,
        title: untitledLabel(previous.cwd),
      }),
    });
    // The stand-in is ours to choose; the TITLE on disk is not, and is left alone.
    // Claude Code copies the cleared session's name into the new transcript, where nothing distinguishes it from a name somebody chose — so a named session goes on showing that name, exactly as `claude --resume` lists it. Overriding it would mean this app and the CLI disagreeing about what a session is called.
    // The pairing is recorded because nothing else can observe it: neither transcript points at the other, and the connection exists only in this moment.
    void window.claudeUi.recordClear(replaced, id, previous.title);
    persistOpenTabs();
    // A group says where this WORK lives, and clearing a session does not move the work — so the replacement joins the group its predecessor was in, rather than the tab visibly dropping out of its section.
    // The predecessor keeps its own membership: it is still a real session, and still that group's history.
    // Only the group carries over. A pin and a note are about one CONVERSATION, and that conversation still has its own row to hold them.
    const group = store.get().groupState.groupOf[replaced];
    if (group) void window.claudeUi.moveSessionToGroup(id, group).then(applyGroupState);
  }
  // What claude just did is in the transcript, and the history of the session on show reads it.
  if (tabOnShow(store.get())?.session.id === id) void history.refresh();
  // 'start' reports which session a tab is running, not a state it is in — and it fires mid-session on clear and compact, where setting a status would wipe a live one.
  // The one SessionStart that does mean a state (a compaction ending) reaches us as 'idle', not as this.
  if (status === 'start') return;
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is (this also replaces the tab's own stand-in row with the real one).
  if (tabWith(id) && !store.get().sessions.some((s) => s.id === id)) void refreshFromDisk();
});

window.claudeUi.onSessionModel((id, model) => {
  store.set({ switchedModel: withEntry(store.get().switchedModel, id, model) });
});

// The sidebar keeps itself current: a transcript created or changed on disk re-renders it.
// So does the history on show, which reads only what was added.
window.claudeUi.onSessionsChanged(() => {
  void refreshFromDisk();
  void history.refresh();
});

// Without the CLI every tab would open on "command not found", which reads as this app being broken rather than as a missing prerequisite. Say which one, and stay on screen until dismissed.
window.claudeUi.onClaudeMissing(() => {
  showToast('The claude CLI was not found on your PATH. Install it and restart claude-ui.', true);
});

async function pickFolderAndOpen(): Promise<void> {
  // Show an active state while the folder picker is open (it has no persistent menu of its own), matching how the other header buttons look while their panel/menu is up.
  newButton.classList.add('active');
  try {
    const dir = await window.claudeUi.pickFolder();
    if (dir) void hostOf('sessions').openNewSession(dir);
  } finally {
    newButton.classList.remove('active');
  }
}
newButton.addEventListener('click', () => void pickFolderAndOpen());
// The header's Settings icon comes from here too, rather than inline in the sidebar's markup, so it is drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
// Where the list was scrolled to is remembered, so a scroll of your own is a change to remember too.
container.addEventListener('scroll', persistUi);

// The window's own title bar, where the app draws its chrome (chrome.ts).
void startChrome();

installTooltips();
// The window's layout, drawn now so the first paint is already the window: the default layout until the file has been read, which the start-up below does before it draws a single row.
initTree({
  where: () => {
    const state = store.get();
    const tab = tabOnShow(state);
    return { tab: tab ? { cwd: tab.session.cwd, repoRoot: tab.session.repoRoot, id: tab.session.id } : null, project: state.activeProject };
  },
  showToast,
  hideToast,
  persist: persistUi,
  // The asks the terminal area answers.
  openSession: (id, prompt) => openLinkedSession(id, { prompt }),
  openTab: (id) => {
    const session = sessionById(id);
    if (session) void openSession(session);
  },
  openNewSession: (cwd, groupId, launch, id) => openNewSession(cwd, groupId, launch, id),
  openWorktreeSession: (repoRoot, groupId) => openWorktreeSession(repoRoot, groupId),
  forkSession: async (id) => {
    const session = sessionById(id);
    if (session) await forkSession(session);
  },
  stopSession: (id) => {
    const tab = tabWith(id);
    if (tab) stopSession(tab.token);
  },
  closeTabs: (id) => {
    for (const tab of store.get().tabs) if (entityKey(tab.session) === id) closeTab(tab.token);
  },
  showProject: (repoRoot) => switchWorkspaceTerminal(repoRoot),
  // The asks the session list answers.
  selectProject: (repoRoot) => selectProject(repoRoot),
  revealSession: (id) => {
    const session = sessionById(id);
    if (session) revealSessionInSidebar(session);
  },
  revealProject: (repoRoot) => revealProjectInSidebar(repoRoot),
  revealGroup: (repoRoot, groupId) => jumpToGroup(repoRoot, groupId),
});
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  void window.claudeUi.getHistoryPins().then((pins) => history.setPins(pins));
  // Before the first render: restoring filters afterwards would draw the whole list and then visibly cut it down.
  const { scrollTop, view } = await restoreUiState();
  // Before the rows and the tabs too: placing the layout moves the sidebar and the terminal area into it, and a move is cheapest, and invisible, while they are still empty.
  await loadLayout();
  // With the project you were in and the view you left, which scope and filter the first draw.
  await renderSessions({ startUp: view });
  forgetDeletedGroupFolds(store.get());
  startSavingUi();
  await restoreOpenTabs();
  // Again, now that the tabs exist. Two filters — open, and running — are questions about the TABS, and the render above happened while there were none, so a restored "open" filter would otherwise show an empty list next to a full tab bar. It also puts the open marker on the rows, which used to wait for the next render for its own reasons.
  renderList(store.get());
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(store.get().activeProject);
  // After the tabs, so a panel's first run is in the restored tab's folder rather than once for the project and again for the tab.
  startPanels();
})();
paneFollows(store.get());
