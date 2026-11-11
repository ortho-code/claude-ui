import type { ScheduledTask, SessionSummary } from '../../../../shared/types';
import { hasVisibleOutput } from '../../../rules/claude';
import { entityKey, unstartableReason } from '../../../rules/sessions';
import { store, type TabState, type View } from '../../../state/app';
import { clearNeedsYou } from '../../../state/needsyou';
import { clearNudge } from '../../../state/statuses';
import { tabOnShow } from '../../../state/views';
import { bindTerminal, createTerminal, fitTerminal, lastLines } from '../../../ui/terminal';
import { showToast } from '../../../ui/toast';
import { isQuitting } from '../../../window/quitting';
import { coolTab } from './leave';
import { persistOpenTabs } from './opentabs';
import { clearStopTimers, isOnShow, remembered, setTab, tabOf, terminalOf, terminals, terminalsEl, type TabLaunch } from './tabstate';
import './terminals.css';

/**
 * The terminal area's tabs and their life: built cold, started when selected, and claude's output and exit while it runs; asking claude to leave is leave.ts's, and closing or finishing closing.ts's.
 * With them the workspace switch, which keeps the tab on show inside the project on show.
 */

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

/**
 * Build a tab WITHOUT a process: real DOM, a real Terminal, no claude.
 * `terminalId` stays null until startTab fills it in, which is what lets tabs be restored cold — 20 restored tabs used to mean 20 `claude --resume` processes at ~437 MB each, spawned whether or not you looked at any of them.
 * The xterm instance stays eager on purpose: an empty one costs almost nothing next to a process, and keeping it non-null confines this to the handful of places that use terminalId.
 */
export function buildTab(session: SessionSummary, scheduledWhenStopped: readonly ScheduledTask[] | null = null): string {
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
    fitTerminal(terminal);
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
    // However the start ended, the button is handed back: it drew the flag, and a repaint by hand made a moment too early once left every freshly started session with a dead one.
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
  fitTerminal(terminal);
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
  remembered.last = entityKey(tab.session);
  remembered.byProject[tab.session.repoRoot] = remembered.last;
  window.claudeUi.setActiveSession(remembered.last, tab.session.repoRoot);
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
    const rememberedKey = repoRoot ? remembered.byProject[repoRoot] : remembered.last;
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
  const terminal = terminalOf(activeTab.token);
  fitTerminal(terminal);
  if (activeTab.terminalId === null) return; // cold: nothing to resize until it starts
  window.claudeUi.resizeTerminal(activeTab.terminalId, terminal.term.cols, terminal.term.rows);
}

// Re-fit whenever the terminal area changes size — the window resized, the tab bar wrapping to a new row, a divider dragged, the layout rebuilt — so the terminal always fills its pane instead of being clipped.
// The window needs no listener of its own: a resize that changes anything a fit reads changes this element's size too.
new ResizeObserver(() => fitActive()).observe(terminalsEl);

// Drop a tab from the UI.
// Idempotent (a user close and the terminal's own exit can both fire).
// It does not touch the terminal process; callers terminate it when they need to.
// `settles` is whether its going settles what its session needed you for: every removal but claude's own exit with an error, a crash, which you did not do (`onTabExit`).
export function removeTab(token: string, settles = true): void {
  const tab = tabOf(token);
  if (!tab) return;
  clearStopTimers(token);
  // Its session's status goes with it, unless another tab holds the session, whose status it is then (`adoptResumed`).
  // Its needs-you mark too, a quit's closes aside, since the mark is for the launch after it.
  if (!store.get().tabs.some((t) => t.token !== token && t.session.id === tab.session.id)) {
    clearNudge(tab.session.id);
    if (settles && !isQuitting()) clearNeedsYou(entityKey(tab.session), 'closed');
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

/** What a tab asked to leave for a close or a finish does at its claude's exit, set once as the terminal area is wired; a tab asked to leave for a stop goes cold (`coolTab`). */
let leftAtExit: (token: string, tab: TabState) => void = () => {};

/** Set what a tab asked to leave for a close or a finish does at its claude's exit. */
export function whenLeft(handler: (token: string, tab: TabState) => void): void {
  leftAtExit = handler;
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
    if (tab.onExit === 'cool') coolTab(token);
    else leftAtExit(token, tab);
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
    // Cold, since its process has gone: the button closes it at once, and selecting it starts it again.
    // Uncovered all the same: this line IS the explanation of the failure, and it is exactly what the loader or the cold pane would otherwise hide.
    setTab(token, { terminalId: null, booting: false, startFailed: true });
    persistOpenTabs();
    return;
  }
  // You leaving claude, by `/exit`, Ctrl-D or two Ctrl-Cs, exits 0 with no signal, and a signal claude catches exits with a code of its own, SIGTERM 143 and SIGHUP 129 (measured on claude 2.1.310), so only the first settles the session's mark.
  // A signal claude cannot catch, SIGKILL or a native crash, comes with code 0 and the signal (node-pty), which keeps it too.
  removeTab(token, exitCode === 0 && !signal);
}
