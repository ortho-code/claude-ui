import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SessionSummary } from '../../../../shared/types';
import { entityKey, hasVisibleOutput, sessionsByKey, unstartableReason } from '../../../logic';
import { newSession, untitledLabel } from '../../../newsession';
import { store, type TabState, type View } from '../../../state/app';
import { moveSessionToGroupById } from '../../../state/groups';
import { clearNudge } from '../../../state/statuses';
import { tabOnShow } from '../../../state/views';
import { bindTerminal, createTerminal, lastLines } from '../../../terminal';
import { showToast } from '../../../toast';
import { terminalsEl } from './index';
import './terminals.css';

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
  /** The session to resume FROM: a fork's parent. A plain resume needs nothing here, since a tab resumes its own session. */
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
export function setTab(token: string, patch: Partial<Omit<TabState, 'token'>>): void {
  store.set({ tabs: store.get().tabs.map((t) => (t.token === token ? { ...t, ...patch } : t)) });
}

/** Whether the tab is the one on show, as a handler asks it. */
export function isOnShow(token: string): boolean {
  return token === store.get().activeTab;
}

// Keep open tabs' sessions in sync with the freshly-read listing: a new session's first message / AI title, a rename, or a regenerated AI title all land here on the next read.
// Always adopt the fresh summary (cheap, and keeps a tab's data from going stale); the store tells whoever draws the tabs only when something a tab shows moved, which is the rows' own question (`sameTabs`, on `sameRow`) — a list of fields kept here once compared only the title and first message, and left a mid-session worktree move or a new sibling off the tab until the next unrelated change.
// A watcher of the listing, which renderer.ts registers with the others.
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
// Set once the app is quitting.
// Shutdown kills every terminal, and each pty exit closes its tab; we must not let those closes persist an empty open-tabs list over the real one (it would wipe the tabs to restore next launch).
// Set via onQuitting, below.
let shuttingDown = false;

export function persistOpenTabs(): void {
  if (restoring || shuttingDown) return;
  // Persist entity keys (session ids — immutable, so a restart always finds them again). A session with no transcript yet is not in the map; its own id stands in, and restore drops it, which is right — there is nothing on disk to reopen.
  const idToKey = new Map(store.get().sessions.map((s) => [s.id, entityKey(s)]));
  window.claudeUi.setOpenSessions(store.get().tabs.map((t) => idToKey.get(t.session.id) ?? t.session.id));
}

export async function restoreOpenTabs(): Promise<void> {
  restoring = true;
  try {
    const [sessions, openKeys, activeKey, byProject] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
      window.claudeUi.getActiveSession(),
      window.claudeUi.getActiveSessionByProject(),
    ]);
    activeByProject = { ...byProject };
    lastActiveKey = activeKey;
    const tips = sessionsByKey(sessions);
    // Restore the tabs COLD — no claude process each.
    // Starting them all was costing 20 processes at ~437 MB on this machine, spawned whether or not any was used, plus 20 CLI cold starts on every launch.
    // A tab starts when you select it.
    let toActivate: string | null = null;
    for (const key of openKeys) {
      const session = tips.get(key);
      if (!session) continue;
      const token = buildTab(session);
      if (key === activeKey) toActivate = token;
    }
    // Land where you left off — SELECTED but not started, since nothing is meant to be live after a restart. Without a remembered tab we open on none rather than guessing.
    if (toActivate) activateTab(toActivate, false);
  } finally {
    restoring = false;
    persistOpenTabs();
  }
}

/**
 * Build a tab WITHOUT a process: real DOM, a real Terminal, no claude.
 * `terminalId` stays null until startTab fills it in, which is what lets tabs be restored cold — 20 restored tabs used to mean 20 `claude --resume` processes at ~437 MB each, spawned whether or not you looked at any of them.
 * The xterm instance stays eager on purpose: an empty one costs almost nothing next to a process, and keeping it non-null confines this to the handful of places that use terminalId.
 */
function buildTab(session: SessionSummary): string {
  const token = crypto.randomUUID();

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  // The xterm itself is the one every terminal here shares (terminal.ts); what follows is the handling that belongs to a tab running claude.
  const { term, fitAddon } = createTerminal(el);
  // The tab's process as it is at the moment of asking, not a captured value: it is null while these handlers are wired and only filled in when the tab is actually started.
  const running = (): number | null => tabOf(token)?.terminalId ?? null;

  // Ctrl+Enter and Shift+Enter insert a newline (send \n, which claude reads as a newline) rather than submitting — matching the terminal (Ctrl+Enter) and Claude Desktop (Shift+Enter) habits.
  // Plain Enter still submits; Ctrl+J and Alt+Enter already produce \n on their own.
  term.attachCustomKeyEventHandler((event) => {
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

  // Ctrl-C twice in the terminal closes the tab instead of dropping to the leftover shell.
  let lastCtrlC = 0;
  term.onData((data) => {
    // Swallow Ctrl+Z: claude binds it to self-suspend, which strands the tab (no shell prompt to `fg` back from).
    // You background a session by switching tabs, so suspend has no use here. claude advertises the key, so a silent no-op is confusing — say why.
    if (data === '\x1a') {
      showToast('Ctrl+Z is off here — switch tabs to keep a session running in the background.');
      return;
    }
    if (data === '\x03') {
      const now = Date.now();
      if (now - lastCtrlC < 600) {
        closeTab(token);
        return;
      }
      lastCtrlC = now;
    }
    const id = running();
    if (id !== null) window.claudeUi.sendTerminalInput(id, data);
  });

  store.set({ tabs: [...store.get().tabs, { token, session, terminalId: null, starting: false, booting: false, stopping: false, failure: null }] });
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
  // Before the await, not after: otherwise a cold tab's pane keeps saying "click its tab to resume it" across the spawn round-trip, which is the one thing you have just done, and its button shows the pause only once the process has arrived.
  setTab(token, { starting: true, booting: true, failure: null });
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
    // Gone while it was still starting: the tab has been removed but the pty has not, so hand it straight back rather than leaving a claude running with nothing pointing at it.
    // The button is disabled throughout the wait, so this is not that route — it is deleting the session, which closes its tab wherever that tab had got to.
    // It has to be the first thing after the await, since everything below touches a terminal that removeTab has already disposed.
    if (!tabOf(token)) {
      window.claudeUi.closeTerminal(terminalId);
      return;
    }
    setTab(token, { terminalId });
    // From here its output and exit are this tab's, until the pty's own exit unbinds it.
    bindTerminal(terminalId, { data: (data) => onTabData(token, data), exit: (exitCode) => onTabExit(token, exitCode) });
    // Reveal it BEFORE fitting: `.term` is display:none until `.active`, and FitAddon sizes from the element's own box, so fitting a hidden pane leaves the terminal at xterm's 80x24 default and claude draws its whole TUI at that width.
    // Cold tabs are what exposed this — the pane used to be revealed by activateTab before any of this ran, and now it only reveals a tab that HAS a process.
    // A tab you switched away from during the await stays hidden and mis-fitted, which activateTab's own fit corrects when you come back to it.
    if (isOnShow(token)) {
      terminal.el.classList.add('active');
      terminal.term.focus();
    }
    // The pty is created at a default size; hand it the real one now that the pane has a real one.
    terminal.fitAddon.fit();
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
 * `start` is false for the two callers that must not spawn here: a RESTORE, which shows you the tab you left off in without starting it (nothing is meant to be live after a restart), and createTab, which starts the tab itself because only it knows the real arguments.
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
  for (const other of store.get().tabs) terminalOf(other.token).el.classList.toggle('active', other.token === token && other.terminalId !== null);
  terminal.fitAddon.fit();
  // A cold tab starts the moment you select it — selecting IS starting, with no separate affordance, because that is how activating a tab has always behaved and laziness should show up only as a wait.
  // Fire-and-forget: activateTab is called from click handlers and stays synchronous.
  if (tab.terminalId === null) {
    // A tab whose folder has gone cannot be started, so say so rather than letting the spawn be refused a moment later with the same message.
    // The tab is KEPT, cold: put the folder back — recreate the worktree at its old path — and the very same tab starts.
    const reason = unstartableReason(tab.session);
    if (reason) {
      setTab(token, { failure: reason });
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

// Drop a tab from the UI. Idempotent (a user close and the terminal's own exit can both fire). It does not touch the terminal process; callers terminate it when they need to.
function removeTab(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  clearNudge(tab.session.id);
  const terminal = terminalOf(token);
  terminal.term.dispose();
  terminal.el.remove();
  terminals.delete(token);
  // One change: the tab on show closing hands over to the next one in scope, so everyone who draws the tabs — and the panels — is told once, of where it ends up rather than of no tab first.
  // A LIVE tab leaves the strip here too, not when the pty's exit eventually lands: `closeTab` removes the tab first and kills the process after.
  store.batch(() => {
    store.set({ tabs: store.get().tabs.filter((t) => t.token !== token) });
    if (isOnShow(token)) store.set({ activeTab: null });
    // Re-establish the active tab within the current workspace scope (or clear).
    switchWorkspaceTerminal(store.get().activeProject);
  });
  persistOpenTabs();
}

/**
 * End the session but keep its tab, cold and resumable.
 * The opposite of closeTab, and the deliberate counterpart to claude exiting on its own — which still CLOSES the tab, so a finished session does not leave an empty one behind.
 * `stopping` is what tells those two apart when the exit arrives.
 */
export function stopSession(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId === null || tab.stopping) return;
  // At once, so the button shows the pause for as long as the exit takes rather than after it — on both buttons, the tab's and the strip's, which follow the same flag.
  setTab(token, { stopping: true });
  window.claudeUi.closeTerminal(tab.terminalId); // Ctrl-C twice, then kill
}

/** Turn a tab that has just lost its process into a cold one. */
function coolTab(token: string): void {
  const terminal = terminalOf(token);
  // Wipe the dead session's output: left in place it reads as a live terminal, and a resume would paint the new session over the old one's tail.
  terminal.term.reset();
  terminal.el.classList.remove('active');
  // One change, which also drops it from the attention strip now rather than when its SessionEnd lands.
  store.batch(() => {
    // A stopped tab is not a slow one: the loader must not outlive the process.
    setTab(token, { terminalId: null, stopping: false, booting: false });
    // Stopping what you were looking at drops you to the empty screen rather than leaving a selected tab with nothing behind it; the panels lose their tab too, and fall back to the project.
    if (isOnShow(token)) store.set({ activeTab: null });
  });
}

/**
 * The tab button's two steps: end the session first, remove the tab second.
 *
 * A running session and a tab are separate things — a cold tab costs nothing but a line in the bar, and it is restored on the next launch — so one press should not decide both.
 * The first press stops (claude gets its normal exit path and flushes), the tab stays and goes cold; the second removes it. A tab that is already cold goes in one press, since there is nothing live to protect.
 * While a session is arriving or leaving the button does nothing at all: see the disabled state in tabElement. Checked here too, since a middle click reaches this without going through the button.
 */
export function closeOrStop(token: string): void {
  const tab = tabOf(token);
  if (!tab || tab.stopping || tab.starting) return;
  if (tab.terminalId !== null) {
    stopSession(token);
    return;
  }
  closeTab(token);
}

// User-initiated close: terminate the session (claude persists per turn, so its context is on disk) and drop the tab. closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills it.
export function closeTab(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId !== null) window.claudeUi.closeTerminal(tab.terminalId); // nothing to kill when cold
  removeTab(token);
}

/** A status event named the session a tab now runs: when that is another session than the tab's, the tab takes it over. */
export function adoptReplacement(tabToken: string, id: string): void {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tabOf(tabToken);
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
    if (group) void moveSessionToGroupById(id, group);
  }
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

function onTabExit(token: string, exitCode: number): void {
  const tab = tabOf(token);
  if (!tab) return; // Already closed by the user.
  // A stop the user asked for: keep the tab, cold, so the layout survives and it can be resumed. Every other exit keeps today's behaviour below.
  if (tab.stopping) {
    coolTab(token);
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
    // Uncover the pane: this line IS the explanation of the failure, and it is exactly what the loader would otherwise hide.
    setTab(token, { booting: false });
    return;
  }
  removeTab(token);
}

// Stop persisting open tabs once shutdown starts, so the terminal-exit closes it triggers don't overwrite the saved tab list with an empty one (see the shuttingDown note above).
window.claudeUi.onQuitting(() => {
  shuttingDown = true;
});
