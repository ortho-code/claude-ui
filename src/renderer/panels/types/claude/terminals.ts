import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { ClosedHow, SetAside, NeedsYou, ScheduledTask, SessionSummary } from '../../../../shared/types';
import { entityKey, hasVisibleOutput, leaveAction, leaveLabel, sessionLabel, sessionsByKey, unstartableReason, type LeaveAction, type TabButtonMark } from '../../../logic';
import { newSession } from '../../../newsession';
import { store, type TabState, type View } from '../../../state/app';
import { moveSessionToGroupById } from '../../../state/groups';
import { clearSetAside, markSetAside } from '../../../state/setaside';
import { clearNeedsYou, markNeedsYou } from '../../../state/needsyou';
import { clearNudge, setScheduled } from '../../../state/statuses';
import { leaveTab, sessionById, tabButtonOf, tabOnShow } from '../../../state/views';
import { bindTerminal, createTerminal, lastLines } from '../../../terminal';
import { showToast } from '../../../toast';
import { fromMarkup } from '../../../dom';
import { isQuitting, whenQuitting } from '../../../quitting';
import { hostOf } from '../builtin';
import './terminals.css';

/** Where the tabs' terminals go: built here, and placed by the pane (pane.ts) under the tab bar. */
export const terminalsEl = fromMarkup(`<div id="terminals"></div>`);

/**
 * The terminal area's tabs and their life: built cold, started when selected, stopped back to cold or closed, and claude's output and exit while it runs.
 * With them the workspace switch, which keeps the tab on show inside the project on show, and which tabs to reopen at the next launch.
 */

/**
 * A tab's terminal, under its token: the xterm and its element, and what only the tab's own lifecycle reads.
 * The tab's data is the store's (`TabState`); a tab is addressed by its token, and each step reads the data as it is at that moment.
 */
interface TabTerminal {
  term: Terminal;
  fitAddon: FitAddon;
  el: HTMLElement;
  // When claude was launched, to tell a real exit from a failed-to-start one.
  startedAt: number;
  // Bumped on each activation, so a workspace switch can restore a project's most-recent tab.
  activatedSeq: number;
}

/**
 * The arguments that apply only to a session's FIRST start, and to nothing else.
 * A resume needs none of them — the session already exists and carries its own name, worktree and history — which is why they are passed in rather than kept on the tab.
 */
export interface TabLaunch {
  /**
   * The session to resume FROM: a fork's parent.
   * A plain resume needs nothing here, since a tab resumes its own session.
   */
  resumeFrom?: string;
  /** Copy the resumed session rather than continue it (`--fork-session`). */
  fork?: boolean;
  /** The session's display name (`--name`). */
  name?: string;
  /** A new git worktree to start in (`-w`): a name, or `''` to let claude pick one. */
  worktree?: string;
  /** The session's first prompt, which claude runs as it starts. */
  prompt?: string;
}

/** Every open tab's terminal, by token; the store's `tabs` says which are open and in what order. */
const terminals = new Map<string, TabTerminal>();

/** A tab's terminal: every open tab has one, from the moment it is built until it is removed. */
export function terminalOf(token: string): TabTerminal {
  return terminals.get(token)!;
}

/** A tab's data as it is now, or undefined once it has been closed — which a step that awaited has to ask again. */
export function tabOf(token: string): TabState | undefined {
  return store.get().tabs.find((t) => t.token === token);
}

/** Change one tab's data: a new entry in place of the old, so everyone who draws it is told. */
function setTab(token: string, patch: Partial<Omit<TabState, 'token'>>): void {
  store.set({ tabs: store.get().tabs.map((t) => (t.token === token ? { ...t, ...patch } : t)) });
}

/** Whether the tab is the one on show, as a handler asks it. */
export function isOnShow(token: string): boolean {
  return token === store.get().activeTab;
}

// Keep open tabs' sessions in sync with the freshly-read listing: a new session's first message / AI title, a rename, or a regenerated AI title all land here on the next read.
// Always adopt the fresh summary (cheap, and keeps a tab's data from going stale); the store tells whoever draws the tabs only when something a tab shows moved, which is the rows' own question (`sameTabs`, on `sameRow`) — a list of fields kept here once compared only the title and first message, and left a mid-session worktree move or a new sibling off the tab until the next unrelated change.
// A watcher of the listing, the terminal area's one rule (watch.ts).
export function reconcileOpenTabs(view: View<'sessions' | 'tabs'>): void {
  const byId = new Map(view.sessions.map((s) => [s.id, s]));
  store.set({
    tabs: view.tabs.map((tab) => {
      const fresh = byId.get(tab.session.id);
      return fresh && fresh !== tab.session ? { ...tab, session: fresh } : tab;
    }),
  });
}

let activationSeq = 0;
// Where you were, per project and overall.
// Seeded from meta at restore and kept current as you switch, so returning to a project lands where you left it even across a restart — `activatedSeq` alone cannot do that, since it resets to 0 when tabs are rebuilt.
let activeByProject: Record<string, string> = {};
let lastActiveKey: string | null = null;
let restoring = false;

/**
 * The open tabs and which of them run, for the next launch.
 * Written when a tab opens, closes or moves, when its process starts, and when its process goes: a stop leaves the tab cold, an exit of its own removes it, and one within its first moments, a failed start, leaves it cold too.
 * A session still being stopped has its process until claude has gone, so it is written as running until then.
 */
export function persistOpenTabs(): void {
  // Once the app is quitting, every terminal is ended and each pty's exit closes its tab: those closes must not persist an empty open-tabs list over the real one, which would wipe the tabs to restore next launch.
  if (restoring || isQuitting()) return;
  const { tabs } = store.get();
  const keyOf = tabKeys();
  window.claudeUi.setOpenSessions(
    tabs.map(keyOf),
    tabs.filter((tab) => tab.terminalId !== null).map(keyOf),
  );
  writeScheduledWhenStopped();
}

/**
 * Each tab's key for the next launch: its session's entity key, immutable, so a restart always finds it again.
 * A session with no transcript yet is not in the map; its own id stands in, and restore drops it, which is right — there is nothing on disk to reopen.
 */
function tabKeys(): (tab: TabState) => string {
  const idToKey = new Map(store.get().sessions.map((s) => [s.id, entityKey(s)]));
  return (tab) => idToKey.get(tab.session.id) ?? tab.session.id;
}

/** What the tabs keep of their sessions' tasks, beside the open tabs, in a write of its own, which main keeps for the open tabs only. */
function writeScheduledWhenStopped(): void {
  const keyOf = tabKeys();
  window.claudeUi.setScheduledWhenStopped(Object.fromEntries(store.get().tabs.flatMap((tab) => (tab.scheduledWhenStopped ? [[keyOf(tab), [...tab.scheduledWhenStopped]]] : []))));
}

export async function restoreOpenTabs(): Promise<void> {
  restoring = true;
  /** The tabs to start once restored: those whose sessions were running when the app closed, when Settings says to start them. */
  const resume: string[] = [];
  /** The sessions to mark as needing you: those that were running when the app closed, unless Settings says to leave them with the others. */
  const marked: string[] = [];
  let closedHow: ClosedHow = 'unknown';
  try {
    // The running list is read here, before the write below replaces it with what runs now, which is nothing yet.
    const [sessions, openKeys, activeKey, byProject, runningKeys, scheduledByKey, settings, lastClosed] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
      window.claudeUi.getActiveSession(),
      window.claudeUi.getActiveSessionByProject(),
      window.claudeUi.getRunningSessions(),
      window.claudeUi.getScheduledWhenStopped(),
      window.claudeUi.getSettings(),
      window.claudeUi.getLastClosed(),
    ]);
    closedHow = lastClosed;
    activeByProject = { ...byProject };
    lastActiveKey = activeKey;
    const tips = sessionsByKey(sessions);
    const atLaunch = settings.runningSessionsAtLaunch.value;
    // Restore the tabs COLD — no claude process each.
    // Starting them all was costing 20 processes at ~437 MB on this machine, spawned whether or not any was used, plus 20 CLI cold starts on every launch.
    // A tab starts when you select it, or below if it was running when the app closed and Settings says to start it: only what was in use costs a process.
    // One change for every tab and the one selected, so whoever draws the tabs draws them once rather than once per tab.
    store.batch(() => {
      let toActivate: string | null = null;
      for (const key of openKeys) {
        const session = tips.get(key);
        // Not a finished one, which is put away rather than resumed (`unopenableReason`): the list has read the finished ones by now, and the tab is dropped from what is kept.
        if (!session || store.get().finished.has(key)) continue;
        const wasRunning = runningKeys.includes(key);
        // What it said was scheduled when its claude went, which it goes on saying until a claude started on it reports.
        const token = buildTab(session, scheduledByKey[key] ?? null);
        if (key === activeKey) toActivate = token;
        // One that was running comes back marked as needing you, unless Settings says to leave it with the others: what was in hand is in the live strip at launch, and stays marked until your next prompt there, started or not.
        if (wasRunning && atLaunch !== 'leave') marked.push(key);
        if (wasRunning && atLaunch === 'start') resume.push(token);
      }
      // Its claude has gone, so what its status file last said is forgotten, as a tab going cold forgets it (`coolTab`): after an end without a quit the file still holds it, and a busy or a waiting from then would hide the mark.
      for (const key of marked) clearNudge(key);
      markNeedsYou(marked, [{ type: 'app.was-running', at: Date.now(), how: closedHow }]);
      // Land where you left off — SELECTED but not started here; it starts below with the others if it was running and Settings says to start them.
      // Without a remembered tab we open on none rather than guessing.
      if (toActivate) activateTab(toActivate, false);
    });
  } finally {
    restoring = false;
    persistOpenTabs();
  }
  // Each in its own tab, the one on show and those out of sight alike.
  // A tab whose folder has gone stays cold, saying why once selected, rather than putting up a toast per tab at launch.
  for (const token of resume) {
    const tab = tabOf(token);
    if (tab && !unstartableReason(tab.session)) void startTab(token);
  }
}

/**
 * Build a tab WITHOUT a process: real DOM, a real Terminal, no claude.
 * `terminalId` stays null until startTab fills it in, which is what lets tabs be restored cold — 20 restored tabs used to mean 20 `claude --resume` processes at ~437 MB each, spawned whether or not you looked at any of them.
 * The xterm instance stays eager on purpose: an empty one costs almost nothing next to a process, and keeping it non-null confines this to the handful of places that use terminalId.
 */
function buildTab(session: SessionSummary, scheduledWhenStopped: readonly ScheduledTask[] | null = null): string {
  const token = crypto.randomUUID();

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  // The tab's process as it is at the moment of asking, not a captured value: it is null while these handlers are wired and only filled in when the tab is actually started.
  const running = (): number | null => tabOf(token)?.terminalId ?? null;

  // The xterm itself is the one every terminal here shares (terminal.ts); what follows is the handling that belongs to a tab running claude.
  // Ctrl+Enter and Shift+Enter insert a newline (send \n, which claude reads as a newline) rather than submitting — matching the terminal (Ctrl+Enter) and Claude Desktop (Shift+Enter) habits.
  // Plain Enter still submits; Ctrl+J and Alt+Enter already produce \n on their own.
  const { term, fitAddon } = createTerminal(el, (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.shiftKey)) {
      // Send the newline once (on keydown), and swallow BOTH keydown and keypress so xterm never turns the accompanying keypress into a submit \r.
      // Shift+Enter emits that keypress (Ctrl+ Enter does not), which is why only Shift+Enter was flaky.
      const id = running();
      if (event.type === 'keydown' && id !== null) window.claudeUi.sendTerminalInput(id, '\n');
      return false;
    }
    return true;
  });

  terminals.set(token, { term, fitAddon, el, startedAt: 0, activatedSeq: 0 });

  // Ctrl-C goes to claude every time, so leaving with it works as in a terminal: from its prompt claude exits, or first asks what it asks on the way out, and its exit closes the tab; mid-turn the first press interrupts the turn.
  // The app once caught the second press and closed the tab itself, which spoke over that question, and was there for a shell left behind after claude that no longer is.
  term.onData((data) => {
    // Swallow Ctrl+Z: claude binds it to self-suspend, which strands the tab (no shell prompt to `fg` back from).
    // You background a session by switching tabs, so suspend has no use here.
    // claude advertises the key, so a silent no-op is confusing — say why.
    if (data === '\x1a') {
      showToast('Ctrl+Z is off here — switch tabs to keep a session running in the background.');
      return;
    }
    const id = running();
    if (id !== null) window.claudeUi.sendTerminalInput(id, data);
  });

  store.set({
    tabs: [...store.get().tabs, { token, session, terminalId: null, starting: false, booting: false, stopping: false, onExit: 'cool', forceable: false, forced: false, notLeft: false, scheduledWhenStopped, failure: null, startFailed: false }],
  });
  return token;
}

/**
 * Give a built tab a process.
 * Separate from buildTab so a tab can exist cold: restored tabs start this way and only spawn when you activate one.
 * Returns early if it is already running, so activating a live tab is free.
 */
export async function startTab(token: string, launch: TabLaunch = {}): Promise<void> {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId !== null || tab.starting) return;
  const terminal = terminalOf(token);
  terminal.startedAt = Date.now();
  // Every way a session begins — new, fork, worktree, resuming a cold tab — funnels through here, so the starting state belongs here rather than at any one call site.
  // Trying again clears what the last attempt said, so a stale reason cannot outlive it.
  // Before the await, not after: otherwise a cold tab's pane keeps saying "click its tab to resume it" across the spawn round-trip, which is the one thing you have just done, and its button says Starting… only once the process has arrived.
  // A failed start's lines are wiped as a stopped session's are, or the new session would paint over them, and its terminal is hidden until this start has a process, as any start's is.
  if (tab.startFailed) {
    terminal.term.reset();
    terminal.el.classList.remove('active');
  }
  setTab(token, { starting: true, booting: true, failure: null, startFailed: false });
  try {
    // Which of the two id flags a start uses is one question: does this session have a transcript?
    // No — the tab's id is one this app minted, so claude is told to CREATE the session under it (claude refuses an id that is already in use, which is exactly the same question).
    // Yes — that id is what there is to resume, and `--session-id` would be refused.
    // A fork is the one start that does both: it resumes the PARENT and creates the tab's own session.
    const { session } = tab;
    const onDisk = store.get().sessions.some((s) => s.id === session.id);
    const terminalId = await window.claudeUi.startTerminal(session.cwd, {
      sessionId: onDisk ? undefined : session.id,
      resumeSessionId: launch.resumeFrom ?? (onDisk ? session.id : undefined),
      fork: launch.fork,
      name: launch.name,
      worktree: launch.worktree,
      prompt: launch.prompt,
      tabToken: token,
    });
    // Gone while it was still starting: the tab has been removed but the pty has not, so end it straight away rather than leaving a claude running with nothing pointing at it.
    // The button is disabled throughout the wait, so this is not that route — it is deleting the session, which closes its tab wherever that tab had got to.
    // Ended outright, not asked: with no tab there is nowhere for anything claude asks on its way out to be answered.
    // It has to be the first thing after the await, since everything below touches a terminal that removeTab has already disposed.
    if (!tabOf(token)) {
      window.claudeUi.killTerminal(terminalId);
      return;
    }
    // What it had scheduled stays until its claude reports its own (`scheduledReported`), since a start says nothing of what it brought back.
    setTab(token, { terminalId });
    persistOpenTabs();
    // From here its output and exit are this tab's, until the pty's own exit unbinds it.
    bindTerminal(terminalId, { data: (data) => onTabData(token, data), exit: (exitCode, signal) => onTabExit(token, exitCode, signal) });
    // Reveal it BEFORE fitting: `.term` is display:none until `.active`, and FitAddon sizes from the element's own box, so fitting a hidden pane leaves the terminal at xterm's 80x24 default and claude draws its whole TUI at that width.
    // Cold tabs are what exposed this — the pane used to be revealed by activateTab before any of this ran, and now it only reveals a tab that HAS a process.
    // One out of sight — switched away from during the await, or started behind another tab, as a launch resumes them — is revealed for the measurement alone and hidden again in the same task, before anything paints, so it draws at the terminal area's width too.
    // That takes an area with a size: in one that is hidden, folded or behind another panel, the fit does nothing, and the tab keeps xterm's 80x24 until activateTab fits it when it is selected.
    const onShow = isOnShow(token);
    terminal.el.classList.add('active');
    // The pty is created at a default size; hand it the real one now that the pane has a real one.
    terminal.fitAddon.fit();
    if (onShow) terminal.term.focus();
    else terminal.el.classList.remove('active');
    window.claudeUi.resizeTerminal(terminalId, terminal.term.cols, terminal.term.rows);
  } catch (error) {
    // The main process refuses to launch into a folder that is no longer there rather than starting somewhere else and saying nothing, so this is where the session gets told.
    // It goes on the PLACEHOLDER rather than into the tab's terminal: the tab stays cold, and a cold tab's pane is covered by the placeholder, so anything written to the terminal would be hidden behind it.
    // The tab is kept rather than closed — put the folder back and the same tab starts.
    // The same wording the row's tooltip and the toast use, so the three cannot drift — this is the backstop for a folder that disappeared while the app was running, which no amount of gating can pre-empt.
    const refused = (error instanceof Error ? error.message : '').includes('MISSING_CWD:');
    const failure = refused ? (unstartableReason({ ...tab.session, cwdExists: false }) ?? '') : 'This session could not be started.';
    setTab(token, { terminalId: null, booting: false, failure });
    showToast(failure);
  } finally {
    // However the start ended, the button is handed back, and the strip's with it: its stop button drew the flag, and a repaint by hand made a moment too early once left every freshly started session with a dead one.
    setTab(token, { starting: false });
  }
}

export async function createTab(session: SessionSummary, launch: TabLaunch = {}): Promise<void> {
  const token = buildTab(session);
  // Select it WITHOUT starting: this call knows the arguments that only apply to a session's FIRST start (--fork-session, --name, -w), and starts the tab itself below.
  // activateTab can only ever resume, and its `starting` flag would then make the real start a no-op.
  activateTab(token, false);
  persistOpenTabs();
  await startTab(token, launch);
}

/**
 * `start` is false for the two callers that must not spawn here: a RESTORE, which shows you the tab you left off in and starts it, if at all, with the others that were running once every tab is built, and createTab, which starts the tab itself because only it knows the real arguments.
 * Every other selection — a click in the tab bar or the sidebar — starts the tab, and can only resume it.
 */
export function activateTab(token: string, start = true): void {
  const tab = tabOf(token);
  if (!tab) return;
  const terminal = terminalOf(token);
  // Viewing a tab no longer clears its nudge: a waiting dot persists until you actually reply (submitting fires UserPromptSubmit -> busy) or you mark it read by clicking the dot.
  terminal.activatedSeq = ++activationSeq;
  store.set({ activeTab: token });
  // A cold tab's (empty) terminal stays hidden, so the placeholder can explain itself instead of showing a blank black pane.
  for (const other of store.get().tabs) terminalOf(other.token).el.classList.toggle('active', other.token === token && (other.terminalId !== null || other.startFailed));
  terminal.fitAddon.fit();
  // A cold tab starts the moment you select it — selecting IS starting, with no separate affordance, because that is how activating a tab has always behaved and laziness should show up only as a wait.
  // Fire-and-forget: activateTab is called from click handlers and stays synchronous.
  if (tab.terminalId === null) {
    // A tab whose folder has gone cannot be started, so say so rather than letting the spawn be refused a moment later with the same message.
    // The tab is KEPT, cold: put the folder back — recreate the worktree at its old path — and the very same tab starts.
    const reason = unstartableReason(tab.session);
    if (reason) {
      // The pane says why, so a failed start's lines give way to it.
      setTab(token, { failure: reason, startFailed: false });
      terminal.el.classList.remove('active');
      if (start) showToast(reason);
    } else if (start) {
      // No arguments: startTab resumes the tab's session, or — for a tab stopped before it ever wrote a transcript — starts it fresh under that same id, so nothing keyed to it is lost.
      void startTab(token);
    }
  } else window.claudeUi.resizeTerminal(tab.terminalId, terminal.term.cols, terminal.term.rows);
  terminal.term.focus();
  // Remembered twice: overall (where to reopen at launch) and for this project (where to return to when you switch back to it).
  lastActiveKey = entityKey(tab.session);
  activeByProject[tab.session.repoRoot] = lastActiveKey;
  window.claudeUi.setActiveSession(lastActiveKey, tab.session.repoRoot);
}

// Full workspace switch: bring the active terminal in line with the current scope (a project, or All).
// Keeps the current tab if it's in scope; otherwise activates the scope's most-recent tab, or clears the terminal if the scope has no open tabs.
// The tab bar, the pane and the rows follow the store.
export function switchWorkspaceTerminal(repoRoot: string | null): void {
  const { tabs } = store.get();
  const scoped = repoRoot ? tabs.filter((t) => t.session.repoRoot === repoRoot) : tabs;
  const shown = tabOnShow(store.get());
  if (!(shown && scoped.some((t) => t.token === shown.token))) {
    // Prefer a tab that is already RUNNING here; failing that, SELECT the one you were last in for this project, cold.
    // Selecting a cold tab is harmless — it is STARTING one that a workspace switch must never do, or browsing projects in the switcher would spawn a session per project you glanced at.
    // Hence activateTab(..., false) either way: it only suppresses the start, which a running tab does not need anyway.
    const running = scoped.filter((t) => t.terminalId !== null);
    const rememberedKey = repoRoot ? activeByProject[repoRoot] : lastActiveKey;
    const seq = (t: TabState): number => terminalOf(t.token).activatedSeq;
    const target = running.length
      ? running.reduce((best, t) => (seq(t) > seq(best) ? t : best))
      : (scoped.find((t) => entityKey(t.session) === rememberedKey) ?? null);
    if (target) {
      activateTab(target.token, false);
      return;
    }
    store.set({ activeTab: null });
    for (const terminal of terminals.values()) terminal.el.classList.remove('active');
  }
}

function fitActive(): void {
  const activeTab = tabOnShow(store.get());
  // A terminal area with no size is hidden — behind another panel of its group, or folded — and a fit now would tell the pty xterm's 80×24 default (the hidden-pane trap); the ResizeObserver below fits it once it has a size again.
  if (!activeTab || terminalsEl.clientWidth === 0 || terminalsEl.clientHeight === 0) return;
  const { term, fitAddon } = terminalOf(activeTab.token);
  fitAddon.fit();
  if (activeTab.terminalId === null) return; // cold: nothing to resize until it starts
  window.claudeUi.resizeTerminal(activeTab.terminalId, term.cols, term.rows);
}

// Re-fit whenever the terminal area changes size — the window resized, the tab bar wrapping to a new row, a divider dragged, the layout rebuilt — so the terminal always fills its pane instead of being clipped.
// The window needs no listener of its own: a resize that changes anything a fit reads changes this element's size too.
new ResizeObserver(() => fitActive()).observe(terminalsEl);

// Drop a tab from the UI.
// Idempotent (a user close and the terminal's own exit can both fire).
// It does not touch the terminal process; callers terminate it when they need to.
// `settles` is whether its going settles what its session needed you for: every removal but claude's own exit with an error, a crash, which you did not do (`onTabExit`).
function removeTab(token: string, settles = true): void {
  const tab = tabOf(token);
  if (!tab) return;
  clearStopTimers(token);
  // Its session's status goes with it, unless another tab holds the session, whose status it is then (`adoptResumed`).
  // Its needs-you mark too, a quit's closes aside, since the mark is for the launch after it.
  if (!store.get().tabs.some((t) => t.token !== token && t.session.id === tab.session.id)) {
    clearNudge(tab.session.id);
    if (settles && !isQuitting()) clearNeedsYou(entityKey(tab.session));
  }
  const terminal = terminalOf(token);
  terminal.term.dispose();
  terminal.el.remove();
  terminals.delete(token);
  // One change: the tab on show closing hands over to the next one in scope, so everyone who draws the tabs — and the panels — is told once, of where it ends up rather than of no tab first.
  store.batch(() => {
    store.set({ tabs: store.get().tabs.filter((t) => t.token !== token) });
    if (isOnShow(token)) store.set({ activeTab: null });
    // Re-establish the active tab within the current workspace scope (or clear).
    switchWorkspaceTerminal(store.get().activeProject);
  });
  persistOpenTabs();
}

/**
 * How long a stop waits before its control becomes a force.
 * Past the moment claude takes to put a question on screen — about 0.5 s from its prompt and 0.9 s mid-turn, measured — so a double-click cannot force a session before what it is asking is even there.
 */
const FORCE_AFTER_MS = 1000;

/**
 * How long a stop goes before it says, where it shows without a hover, that claude has not left (`notLeftWords`, and a toast).
 * Past most exits, so an ordinary one says nothing: of the 49 exits after an ask the app's logs held to 2026-10-23, half had gone by 1.43 s, 95 % by 2.98 s, and the slowest took 6.6 s.
 */
const NOT_LEFT_AFTER_MS = 3000;

/** Each stopping tab's pending steps, its control becoming a force and its saying claude has not left, so a stop that ends, is called off or is forced takes them with it. */
const stopTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

function clearStopTimers(token: string): void {
  for (const timer of stopTimers.get(token) ?? []) clearTimeout(timer);
  stopTimers.delete(token);
}

/**
 * Ask a live tab's claude to leave, and wait for the exit, however long it takes: `onExit` says whether the tab goes with it or stays cold.
 * Claude can answer an exit with a question — a worktree with changes asks whether to keep it — and the tab has to outlive it for it to be answered, so nothing here ends the session itself.
 * Mid-turn, as the hooks last reported it, claude needs a third Ctrl-C, since the first then only interrupts the turn; any other session gets two, because a third at its prompt would arm claude's own "press again to exit" under its question.
 * Waiting counts as mid-turn, though claude also reports it for a session idle at its prompt, which then gets the third press as well.
 * So does a session with a task scheduled, as its clock in its own colour shows (a muted one, kept from before its claude started, adds none): a `/loop` wakeup takes the first press to cancel itself, and the same press interrupts a turn, so it is one more either way, never two; a cron makes claude ask what to do with it, where the third only arms "press again to exit" for a moment and the question stays (both measured on claude 2.1.302).
 * The list is the last Stop's, so it can still name a wakeup cancelled since by an Esc at claude's prompt; the third press then lands on whatever claude asks on its way out, where one press only arms "press again" too (measured at the worktree question).
 * Nothing asks first: claude asks its own question for a cron, and a second one before it was too much (decided 2026-10-24); the clock's tooltip says what becomes of each task (`afterStop`).
 */
function askToLeave(token: string, terminalId: number, onExit: TabState['onExit']): void {
  const tab = tabOf(token);
  if (!tab) return;
  // At once, so the button shows the leave under way for as long as the exit takes rather than after it — on both buttons, the tab's and the strip's, which follow the same flag.
  setTab(token, { stopping: true, onExit, forceable: false, notLeft: false });
  const { statuses, scheduledTasks } = store.get();
  const status = statuses.get(tab.session.id);
  window.claudeUi.closeTerminal(terminalId, status === 'busy' || status === 'waiting' || scheduledTasks.has(tab.session.id));
  clearStopTimers(token);
  // Each step only for the ask it was set for, still under way.
  const step = (patch: Partial<TabState>, after: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => {
      const now = tabOf(token);
      if (now?.stopping && now.terminalId === terminalId) setTab(token, patch);
    }, after);
  stopTimers.set(token, [step({ forceable: true }, FORCE_AFTER_MS), step({ notLeft: true }, NOT_LEFT_AFTER_MS)]);
}

/**
 * End a session that was asked to leave and has not: the stop control's second act, once it has become a force.
 * Its process group gets `SIGTERM`, and `SIGKILL` after the grace, so whatever claude was asking goes unanswered — for a worktree, the tree is kept.
 * The control goes back to unavailable until the exit lands, which the escalation in main makes sure of.
 */
function forceStop(token: string): void {
  const tab = tabOf(token);
  if (!tab?.forceable || tab.terminalId === null) return;
  // Nothing is asked any more, so nothing is said of it either.
  clearStopTimers(token);
  setTab(token, { forceable: false, forced: true, notLeft: false });
  window.claudeUi.killTerminal(tab.terminalId);
}

/**
 * End a tab's claude without asking it, keeping the tab, cold: for a claude that must not go on, which an ask it ignores would leave running.
 * The tab says it is stopping until the exit lands, as any stop does, and the exit cools it.
 */
function forceOutAtOnce(token: string): void {
  if (tabOf(token)?.terminalId == null) return;
  clearStopTimers(token);
  // A stop already past its ask, so the force is the one every stop ends in.
  setTab(token, { stopping: true, onExit: 'cool', forceable: true, notLeft: false });
  forceStop(token);
}

/**
 * End the session but keep its tab, cold and resumable.
 * The opposite of closeTab, and the deliberate counterpart to claude exiting on its own — which still CLOSES the tab, so a finished session does not leave an empty one behind.
 * `stopping` is what tells those two apart when the exit arrives.
 * A claude already leaving, for a close or a finish, is asked nothing more: its exit keeps the tab instead (decided 2026-10-28), as a close changes a stop.
 */
function stopSession(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId === null || tab.starting) return;
  if (tab.stopping) {
    setTab(token, { onExit: 'cool' });
    return;
  }
  askToLeave(token, tab.terminalId, 'cool');
}

/**
 * A leave item pressed, from the session's menu, the tab's button or the strip's (`leaveAction`): Stop session, Close tab, Finished, or the force of what claude is leaving for.
 * It acts only while the item would still do the same, and, given the mark it was drawn with, still draws it, since a press can land on an item drawn before the tab moved on — a Force stop pressed once claude has gone would otherwise close the tab (decided 2026-10-21).
 */
export function pressLeave(token: string, action: LeaveAction, mark?: TabButtonMark): void {
  const tab = tabOf(token);
  if (!tab) return;
  const now = leaveAction(tab, action);
  if (now.disabled || (mark !== undefined && now.mark !== mark)) return;
  if (now.mark === `force-${action}`) forceStop(token);
  else if (action === 'stop') stopSession(token);
  else if (action === 'close') closeTab(token, true);
  else finishSessions([entityKey(tab.session)]);
}

/**
 * A session asked to leave that went on working: a prompt it submitted, or a `/resume` or `/clear` that moved its tab to another session (`adoptReplacement`), so the stop is off and the tab is live again.
 * Claude's exit can be called off — Esc at a worktree's keep-or-remove question takes it back to its prompt — and only what is done next says so; until then the tab goes on saying it is stopping.
 * Whatever the leave was, a stop, a close or a finish, it goes (decided 2026-10-28: a leave left unfinished for something else is one called off).
 * Not once its claude has been forced out (`forced`): that claude is being ended whatever it reports.
 * Answers the tab as it was when its leave was called off, or null when there was none to call off.
 */
function stopCalledOff(token: string): TabState | null {
  const tab = tabOf(token);
  if (!tab?.stopping || tab.forced) return null;
  clearStopTimers(token);
  setTab(token, { stopping: false, onExit: 'cool', forceable: false, notLeft: false });
  return tab;
}

/**
 * A prompt a tab's claude submitted: it went on working, so a leave under way is off (`stopCalledOff`).
 * A finish called off by one says so, since a prompt sent just before the press can report after it, and claude then leaves on the presses with the session unfinished (decided 2026-10-28).
 * Only a prompt: a `/resume` or `/clear` that calls a finish off is one you typed, and one into a session another tab runs already says that it runs there.
 */
export function promptSubmitted(token: string): void {
  const calledOff = stopCalledOff(token);
  if (calledOff?.onExit === 'finish') showToast(`Finishing "${sessionLabel(calledOff.session)}" was called off`);
}

/**
 * A session's claude reported what it has scheduled (`session:scheduled`), a list or none: a tab that runs it no longer needs what it kept from when its claude last went, since its clock now shows what is so (`clockOf`).
 * A tab already cold keeps it: the report that empties a gone claude's list is its status files going.
 * A tab started again before they went loses it to that report.
 */
export function scheduledReported(id: string): void {
  const reported = store.get().tabs.filter((t) => t.session.id === id && t.terminalId !== null && t.scheduledWhenStopped);
  if (reported.length === 0) return;
  store.batch(() => {
    for (const tab of reported) setTab(tab.token, { scheduledWhenStopped: null });
  });
  persistOpenTabs();
}

/**
 * What a tab keeps of its session's tasks once its claude has gone, by a stop or a quit: what comes back when the session is opened again, its crons, since a `/loop` wakeup ends with the session (`afterStop`); null for none.
 * A claude that went before it reported at all leaves what the tab already kept from the stop before, which is still all that is known.
 */
function keptWhenGone(tab: TabState): TabState['scheduledWhenStopped'] {
  const live = store.get().scheduledTasks.get(tab.session.id);
  const kept = live ? live.filter((task) => task.cron !== null) : tab.scheduledWhenStopped;
  return kept && kept.length > 0 ? kept : null;
}

// A quit forces every claude out, and the exits it causes write nothing (`persistOpenTabs`), so each tab still running keeps what its stop would have kept, written as the window hears of the quit, which main tells it before it ends any.
whenQuitting(() => {
  for (const tab of store.get().tabs) if (tab.terminalId !== null) setTab(tab.token, { scheduledWhenStopped: keptWhenGone(tab) });
  writeScheduledWhenStopped();
});

/** Turn a tab that has just lost its process into a cold one. */
function coolTab(token: string): void {
  const terminal = terminalOf(token);
  // Wipe the dead session's output: left in place it reads as a live terminal, and a resume would paint the new session over the old one's tail.
  terminal.term.reset();
  terminal.el.classList.remove('active');
  // What the cold tab goes on showing, read before its claude's report is forgotten with the rest.
  const tab = tabOf(token)!;
  const id = tab.session.id;
  const scheduledWhenStopped = keptWhenGone(tab);
  // Its claude has gone, so its last report is forgotten, as closing a tab forgets it: a claude forced out may never report that it ended, and its busy or waiting would go on nudging from every roll-up.
  // A SessionEnd that does arrive writes `closed`, which draws the same hollow dot as no status.
  clearNudge(id);
  // One change, which also drops it from the live strip now rather than when its SessionEnd lands.
  store.batch(() => {
    // A stopped tab is not a slow one: the loader must not outlive the process.
    setTab(token, { terminalId: null, stopping: false, onExit: 'cool', forceable: false, forced: false, notLeft: false, booting: false, scheduledWhenStopped });
    // Stopping what you were looking at drops you to the empty screen rather than leaving a selected tab with nothing behind it; the panels lose their tab too, and fall back to the project.
    if (isOnShow(token)) store.set({ activeTab: null });
  });
  persistOpenTabs();
}

/**
 * The tab button's two steps: end the session first, remove the tab second.
 *
 * A running session and a tab are separate things — a cold tab costs nothing but a line in the bar, and it is restored on the next launch — so one press should not decide both.
 * The first press stops (claude gets its normal exit path and flushes), the tab stays and goes cold; the second removes it, unless the settings make it one press, or no button, for which a press does nothing.
 * While a session is arriving, or in the first moment of leaving, the button does nothing at all, and a session that is slow to leave is forced: see tabButton.
 * Checked here too, since a middle click reaches this without going through the button, and with `mark`, the one the strip's button was drawn with, only while the button still draws it.
 */
export function pressTabButton(token: string, mark?: TabButtonMark): void {
  const tab = tabOf(token);
  if (!tab) return;
  const button = tabButtonOf(tab);
  if (button && !button.disabled && (mark === undefined || button.mark === mark)) pressLeave(token, button.action, button.mark);
}

/** A tab you removed, as it was, so Undo can put it back: its session, where it stood among the tabs, and what it kept of its session's crons. */
interface RemovedTab {
  session: SessionSummary;
  at: number;
  scheduledWhenStopped: TabState['scheduledWhenStopped'];
  /** Every reason its session needed you for, which its going settled. */
  needsYou: readonly NeedsYou[] | null;
}

/** What Undo needs of a tab about to be removed, read before it goes. */
function removedTab(tab: TabState): RemovedTab {
  return {
    session: tab.session,
    at: store.get().tabs.findIndex((t) => t.token === tab.token),
    scheduledWhenStopped: keptWhenGone(tab),
    needsYou: store.get().needsYou.get(entityKey(tab.session)) ?? null,
  };
}

/**
 * Undo's put-back: each tab back where it stood, cold, as a tab restored at launch is, and marked as needing you again if it was; nothing starts.
 * `removed` is in the order the tabs went, each `at` counted among the tabs as they were then, so they come back last first.
 * A session another tab holds by now, opened again meanwhile, keeps that tab rather than gaining a second, and a finished one gets none, since the app opens no finished session.
 */
function putBack(removed: readonly RemovedTab[]): void {
  for (const { session, at, scheduledWhenStopped, needsYou } of [...removed].reverse()) {
    if (store.get().tabs.some((t) => t.session.id === session.id) || store.get().finished.has(entityKey(session))) continue;
    // As it was, from when it was marked, so a set-aside mark that muted it mutes it again.
    if (needsYou) markNeedsYou([entityKey(session)], needsYou);
    // Built at the end, as every tab is, then moved to where it stood.
    buildTab(session, scheduledWhenStopped);
    const tabs = [...store.get().tabs];
    const built = tabs.pop()!;
    tabs.splice(Math.min(Math.max(at, 0), tabs.length), 0, built);
    store.set({ tabs });
  }
  persistOpenTabs();
}

/**
 * The toast a close you pressed raises once its tabs have gone, one for a batch, with Undo putting the tabs it removed back where they were (decided 2026-10-28), and Finished and Set aside… for the sessions it closed, so deciding what becomes of them is one press while it is cheapest (decided 2026-11-05).
 * Whichever is pressed, the toast it raises has an Undo back to before the close: Finished's puts the tabs back as a finish's Undo does for the tabs it closed, and Set aside…'s takes the marks off and puts the tabs back; cancelling Set aside… brings this toast back.
 */
function offerUndoClose(removed: readonly RemovedTab[]): void {
  const said = removed.length === 1 ? `Closed "${sessionLabel(removed[0]!.session)}"` : `Closed ${removed.length} tabs`;
  const keys = [...new Set(removed.map((r) => entityKey(r.session)))];
  showToast(said, false, [
    { label: 'Undo', run: () => putBack(removed) },
    { label: leaveLabel('finish'), run: () => finishSessions(keys, removed) },
    { label: 'Set aside…', run: () => void setAsideClosed(keys, removed) },
  ]);
}

/** Set aside… from a close's toast: the session list's dialog for the sessions it closed, then a toast whose Undo takes the marks off and puts the tabs back, or the close's toast again when the dialog is cancelled. */
async function setAsideClosed(keys: readonly string[], removed: readonly RemovedTab[]): Promise<void> {
  const done = await hostOf('claude').setAside(keys);
  if (!done) {
    offerUndoClose(removed);
    return;
  }
  showToast(done.said, false, [
    {
      label: 'Undo',
      run: () => {
        done.undo();
        putBack(removed);
      },
    },
  ]);
}

/**
 * Close the tabs of several sessions at once, as Close tab in the session list's bar does (docs/architecture.md § Selecting several): each tab by the rule its menu's Close tab follows (`leaveAction`), never forcing one already closing, and a tab starting left as it is.
 * The cold ones go at once and raise one toast, whose Undo puts them all back; a running one goes once its claude has gone, with its own Undo then, as a single close does.
 */
export function closeTabs(keys: readonly string[]): void {
  const wanted = new Set(keys);
  const removed: RemovedTab[] = [];
  for (const tab of store.get().tabs.filter((t) => wanted.has(entityKey(t.session)))) {
    const item = leaveAction(leaveTab(tab), 'close');
    if (item.disabled || item.mark !== 'close') continue;
    if (tab.terminalId === null) {
      removed.push(removedTab(tab));
      removeTab(tab.token);
    } else pressLeave(tab.token, 'close', 'close');
  }
  if (removed.length > 0) offerUndoClose(removed);
}

/**
 * Close a tab: at once when it is cold, and for a live one once its claude has gone, asked to leave as a stop asks it.
 * The tab outlives the session because claude can ask something on its way out, which a tab removed first would make unanswerable: it is kept, stopping, until the exit lands, and goes then.
 * claude persists per turn, so a session's context is on disk whichever way it ends.
 * `undoable` is a close you pressed of a cold tab, whose going offers Undo at once; a live tab's close offers it at its exit (`onTabExit`), unless a finish closed it, whose own toast is its Undo.
 */
export function closeTab(token: string, undoable = false): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId === null) {
    const removed = removedTab(tab);
    removeTab(token);
    if (undoable) offerUndoClose([removed]);
    return;
  }
  // Already leaving: it goes with the exit rather than staying cold.
  if (tab.stopping) {
    setTab(token, { onExit: 'close' });
    return;
  }
  askToLeave(token, tab.terminalId, 'close');
}

/**
 * Mark sessions finished, closing every tab each is open in: at once where no claude of the app's runs it, all of those in one write with one toast, and where one does, once that claude has gone, asked to leave as a close asks it.
 * The mark waits for the exit so that no claude the app runs when it is written runs a finished session, and the tab waits so that what claude asks on its way out can be answered there.
 * A claude already asked to leave, by a stop or a close, is asked nothing more, since a second pair of presses ends what it asks on its way out unanswered: its exit finishes instead, as a close changes a stop.
 * Going on working meanwhile, a prompt or a `/resume` or `/clear`, calls the finish off with the stop (`stopCalledOff`), a prompt saying so (`promptSubmitted`), and a quit finishes nothing (`finishAtExit`).
 * Not a session with a tab starting, which has no claude yet to ask; the menu's Finished is unavailable then, and a batch leaves it out.
 * `closed` are tabs a close removed already, whose toast's Finished this is: its Undo puts them back with the rest.
 */
export function finishSessions(keys: readonly string[], closed: readonly RemovedTab[] = []): void {
  const now: string[] = [];
  for (const key of keys) {
    const held = store.get().tabs.filter((t) => entityKey(t.session) === key);
    if (held.some((t) => t.starting)) continue;
    // A fresh finish starts its list afresh, so what a finish called off had removed is not put back by this one's Undo.
    if (!held.some((t) => t.stopping && t.onExit === 'finish')) finishRemoved.delete(key);
    finishedTabs(key).push(...closed.filter((r) => entityKey(r.session) === key));
    if (held.every((t) => t.terminalId === null)) {
      now.push(key);
      continue;
    }
    for (const tab of held) {
      if (tab.terminalId === null) {
        finishedTabs(key).push(removedTab(tab));
        removeTab(tab.token);
      } else if (tab.stopping) setTab(tab.token, { onExit: 'finish' });
      else askToLeave(tab.token, tab.terminalId, 'finish');
    }
  }
  if (now.length > 0) void finishNow(now);
}

/** Per session being finished, the tabs its finish has removed so far, for its Undo to put back; taken when the mark is written. */
const finishRemoved = new Map<string, RemovedTab[]>();

function finishedTabs(key: string): RemovedTab[] {
  let removed = finishRemoved.get(key);
  if (!removed) finishRemoved.set(key, (removed = []));
  return removed;
}

/** What a finish's Undo puts back of one session: its set-aside and needs-you marks as they were, read before the write. */
interface FinishedMarks {
  key: string;
  setAside: SetAside | null;
  needsYou: readonly NeedsYou[] | null;
}

/** A session's title, for a toast, or the start of its id when the app no longer has it. */
function titleOf(key: string, removed: readonly RemovedTab[]): string {
  const session = sessionById(key) ?? removed.find((r) => entityKey(r.session) === key)?.session;
  return session ? `"${sessionLabel(session)}"` : `"${key.slice(0, 8)}"`;
}

/** The toast a finish raises once its marks are written, one for a batch, with Undo making them unfinished in one write, putting back the tabs the finish closed (decided 2026-10-28), and each one's set-aside and needs-you marks as they were, a session with no tab too. */
function offerUndoFinish(marks: readonly FinishedMarks[], removed: readonly RemovedTab[]): void {
  const keys = marks.map((m) => m.key);
  const what = keys.length === 1 ? titleOf(keys[0]!, removed) : `${keys.length} sessions`;
  showToast(`Finished ${what}`, false, [
    {
      label: 'Undo',
      run: () =>
        void window.claudeUi.unfinish(keys).then(
          (finished) => {
            store.set({ finished: new Map(Object.entries(finished)) });
            for (const { key, setAside: setAside, needsYou } of marks) {
              if (setAside) markSetAside([key], setAside.due, setAside.at);
              if (needsYou) markNeedsYou([key], needsYou);
            }
            putBack(removed);
          },
          () => showToast(`Couldn't make ${what} unfinished; make ${keys.length === 1 ? 'it' : 'them'} unfinished from the finished sessions`),
        ),
    },
  ]);
}

/**
 * Write the finished marks of sessions, in one write, and close their tabs in the same change, so the list draws once, with both gone.
 * A tab opened while main writes is closed too: its claude, if one has started by then, asked to leave as a close asks it, after the mark, or closed at its exit if it was leaving already, and one still starting ended as it arrives.
 * A write main refuses says so, since at an exit the tab is gone already and the row staying would be all that says it.
 */
async function finishNow(keys: readonly string[]): Promise<void> {
  let finished: Map<string, number>;
  // Read before the write, as the tabs are, for Undo: with or without a tab, a session was set aside, or needed you.
  const marks: FinishedMarks[] = keys.map((key) => ({ key, setAside: store.get().setAside.get(key) ?? null, needsYou: store.get().needsYou.get(key) ?? null }));
  try {
    finished = new Map(Object.entries(await window.claudeUi.finish([...keys])));
  } catch {
    for (const key of keys) finishRemoved.delete(key);
    showToast(`Couldn't finish ${keys.length === 1 ? `${titleOf(keys[0]!, [])}. It's` : `${keys.length} sessions. They're`} still here.`);
    return;
  }
  const removed: RemovedTab[] = [];
  for (const key of keys) {
    removed.push(...finishedTabs(key));
    finishRemoved.delete(key);
  }
  const wanted = new Set(keys);
  store.batch(() => {
    store.set({ finished });
    for (const tab of store.get().tabs) {
      if (!wanted.has(entityKey(tab.session))) continue;
      if (tab.terminalId === null) removed.push(removedTab(tab));
      closeTab(tab.token);
    }
    // Main's finish took the marks off as it finished (src/main/meta.ts); after the tabs, whose Undo puts the needs-you mark back.
    for (const key of keys) clearNeedsYou(key);
    clearSetAside(keys);
  });
  offerUndoFinish(marks, removed);
}

/**
 * The exit of a claude asked to leave for a finish, its tab already gone: the session is finished once no tab holds it.
 * A tab still holding it is either still leaving for the finish, whose exit finishes it then, or one whose stop was called off, where the session is being worked in.
 * Not at a quit: a claude that had not gone may still have needed you, answering its question say, so the session stays unfinished and its tab comes back at the next launch, as a close under way does (decided 2026-10-28).
 */
function finishAtExit(key: string): void {
  if (isQuitting()) return;
  if (store.get().tabs.some((t) => entityKey(t.session) === key)) return;
  void finishNow([key]);
}

/**
 * A claude's start or a status event named the session a tab now runs: when that is another session than the tab's, the tab takes it over.
 * `source` is why, as claude's SessionStart says: only `clear` makes it a new session, and '' (a status event, which does not say) is taken as an existing one, since a clear's part done to one would move it out of its group.
 * Answers the tab already running that session when the take-over was undone for it (`adoptResumed`), for the caller to bring on show; else null.
 */
export function adoptReplacement(tabToken: string, id: string, source: string): TabState | null {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`, and claude's own `/resume` goes on in another session that already exists, under that session's id.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tabOf(tabToken);
  if (!owner || owner.session.id === id) return null;
  // A claude forced out asks nothing more of the tab while it goes, a report still on its way included: the tab keeps the session it ran, whatever that claude went on in.
  if (owner.forced) return null;
  if (source !== 'clear') return adoptResumed(owner, id);
  const previous = owner.session;
  const replaced = previous.id;
  // A CLEARED SESSION IS A NEW SESSION, so it starts from the same blank the "+" button does rather than from its predecessor's row.
  // Carrying the old object forward was the app's own half of the copied-title problem: it kept the title, the first message and the sibling marks of a conversation this session does not have.
  // The folder is all that genuinely survives — it is the same terminal, in the same place.
  // Everything that draws the tab follows: the bar names the new session, its stand-in row is the open one, and the history on show follows it, since a cleared session has a transcript of its own.
  // A clear while claude was asked to leave is going on working, as a prompt is: the leave is off.
  stopCalledOff(owner.token);
  // What the tab kept from its claude's last stop was the cleared session's, so it goes with it.
  setTab(owner.token, { session: blankAfter(previous, id), scheduledWhenStopped: null });
  // No claude of the app's runs the cleared session now, so what it had scheduled is not shown for it, though nothing will say its list emptied.
  setScheduled(replaced, []);
  // Nor does a tab hold it, which settles what it needed you for, as a close does; the new session needs nothing yet.
  clearNeedsYou(entityKey(previous));
  // The stand-in is a blank; the TITLE on disk is Claude's, and is left alone.
  // Claude Code copies the cleared session's name into the new transcript, and a title from Claude is a session's name before anything else — so a named session goes on showing that name, exactly as `claude --resume` lists it.
  // Overriding it would mean this app and the CLI disagreeing about what a session is called.
  // The pairing is recorded because nothing else can observe it: neither transcript points at the other, and the connection exists only in this moment.
  void window.claudeUi.recordClear(replaced, id, previous.title);
  persistOpenTabs();
  // A group says where this WORK lives, and clearing a session does not move the work — so the replacement joins the group its predecessor was in, rather than the tab visibly dropping out of its section.
  // The predecessor keeps its own membership: it is still a real session, and still that group's history.
  // Only the group carries over.
  // A pin and a note are about one CONVERSATION, and that conversation still has its own row to hold them.
  const group = store.get().groupState.groupOf[replaced];
  if (group) void moveSessionToGroupById(id, group);
  return null;
}

/**
 * A tab whose claude went on in a session that already exists, by its own `/resume`: the tab takes it as it is, its row, title, group and pin, with nothing carried from the session before.
 * Finishing is this app's and claude cannot see it, so the session can be a finished one: it is made unfinished, since the app runs no finished session, and a toast says so, since nobody pressed Unfinished.
 * Another tab can hold the session too: one with no claude behind it goes, since this tab is the session's now; one running it is left alone and the take-over undone, this tab's claude forced out and the tab kept on the session it ran before, and that tab is answered.
 */
function adoptResumed(owner: TabState, id: string): TabState | null {
  // claude lets a second claude resume a session another runs, and the two then branch its transcript, each turn hanging off the same message, so a later resume drops one of them (measured on claude 2.1.302).
  // No hook can refuse a `/resume` (SessionStart cannot block, and neither UserPromptSubmit nor UserPromptExpansion fires for it, measured), so this is the closest to refusing it: the claude that switched is forced out as soon as the app hears of it, before any turn of its own unless one was submitted first.
  const other = store.get().tabs.find((t) => t.token !== owner.token && t.session.id === id);
  if (other && (other.terminalId !== null || other.starting)) {
    // Forced, not asked: in the app such a claude was seen to ignore the Ctrl-C an ask sends (three times out of three, 2026-10-20, cause unknown), and the two of those forced went within a second; it has nothing of its own to finish.
    // Once: a report from it while it goes asks nothing more (`forced`, above).
    // A claude you had asked to leave went on working too, so that leave is off, and it is forced all the same, since it is a second claude in the session either way.
    stopCalledOff(owner.token);
    forceOutAtOnce(owner.token);
    return other;
  }
  // Its row where another tab or the listing has it; else the blank, until the listing reads it (`reconcileOpenTabs`).
  const session = sessionById(id) ?? blankAfter(owner.session, id);
  // A resume while claude was asked to leave is going on working, as after a clear.
  stopCalledOff(owner.token);
  // What the tab kept from its claude's last stop was the session it left, as after a clear.
  setTab(owner.token, { session, scheduledWhenStopped: null });
  // The session it left runs in no claude of the app's now, as after a clear, and no tab holds it, which settles what it needed you for.
  setScheduled(owner.session.id, []);
  clearNeedsYou(entityKey(owner.session));
  // After the take-over, so the session's status, which is this tab's now, stays (`removeTab`).
  if (other) removeTab(other.token);
  persistOpenTabs();
  const key = entityKey(session);
  if (!store.get().finished.has(key)) return null;
  void window.claudeUi.unfinish([key]).then((finished) => {
    store.set({ finished: new Map(Object.entries(finished)) });
    showToast(`"${sessionLabel(session)}" was finished; resuming it in claude made it unfinished`);
  }, () => showToast(`"${sessionLabel(session)}" is finished and running; make it unfinished from the finished sessions`));
  return null;
}

/** The "+" button's blank for session `id`, in the folder of the session a tab ran before it: the same terminal, in the same place. */
function blankAfter(previous: SessionSummary, id: string): SessionSummary {
  return newSession(id, { cwd: previous.cwd, repoRoot: previous.repoRoot, isRepo: previous.isRepo, worktree: previous.worktree });
}

function onTabData(token: string, data: string): void {
  const tab = tabOf(token);
  // Output still on its way from a claude whose tab has already been closed.
  if (!tab) return;
  terminalOf(token).term.write(data);
  // First VISIBLE output: the pane has something to show, so stop covering it.
  if (tab.booting && hasVisibleOutput(data)) setTab(token, { booting: false });
}

/** How much of what a failed start printed goes into the log: enough for claude's own error and the line before it, and little enough that a resumed session's history, which it draws first, mostly stays out. */
const FAILED_START_LINES = 5;

function onTabExit(token: string, exitCode: number, signal = 0): void {
  const tab = tabOf(token);
  if (!tab) return; // Already closed by the user.
  clearStopTimers(token);
  // A stop the user asked for: keep the tab, cold, so the layout survives and it can be resumed — or, for a close or a finish, remove it now that claude has gone, and mark the session finished for the finish.
  // Every other exit keeps today's behaviour below.
  if (tab.stopping) {
    if (tab.onExit === 'cool') {
      coolTab(token);
      return;
    }
    const key = entityKey(tab.session);
    const removed = finishedTabs(key);
    removed.push(removedTab(tab));
    removeTab(token);
    if (tab.onExit === 'finish') {
      finishAtExit(key);
      return;
    }
    // A close: a finish it was turned from leaves no mark, so the tabs that finish had removed already come back with this one's Undo.
    finishRemoved.delete(key);
    // One a finish closed, opened while it wrote its mark, offers nothing: the finish's own toast is the Undo.
    if (!store.get().finished.has(key)) offerUndoClose(removed);
    return;
  }
  // A near-instant exit almost always means claude failed to start (bad env, not found, rc error).
  // Keep the tab so the error stays visible instead of flashing away.
  // Otherwise claude exited normally, so close the tab — no leftover shell.
  const { term, startedAt } = terminalOf(token);
  const ran = Date.now() - startedAt;
  if (ran < 1500) {
    // What it said before it went, for the log: main records the exit, only the terminal has the words.
    // Read once xterm has parsed everything written so far, and before the line below adds the app's own.
    term.write('', () => {
      const said = lastLines(term, FAILED_START_LINES);
      window.claudeUi.log(
        'warn',
        'tab',
        `session ${tab.session.id} did not start: claude exited with code ${exitCode} after ${ran} ms${said.length > 0 ? `, its last lines:\n${said.join('\n')}` : ', printing nothing'}`,
      );
    });
    term.writeln(`\r\n[claude exited immediately (code ${exitCode}) — the session did not start]`);
    // Cold, since its process has gone: the button closes it at once, the strip drops it, and selecting it starts it again.
    // Uncovered all the same: this line IS the explanation of the failure, and it is exactly what the loader or the cold pane would otherwise hide.
    setTab(token, { terminalId: null, booting: false, startFailed: true });
    persistOpenTabs();
    return;
  }
  // You leaving claude, by `/exit`, Ctrl-D or two Ctrl-Cs, exits 0 with no signal, and a signal claude catches exits with a code of its own, SIGTERM 143 and SIGHUP 129 (measured on claude 2.1.310), so only the first settles the session's mark.
  // A signal claude cannot catch, SIGKILL or a native crash, comes with code 0 and the signal (node-pty), which keeps it too.
  removeTab(token, exitCode === 0 && !signal);
}
