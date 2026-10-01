import { NO_TRANSCRIPT, readFrom } from '../../../src/shared/history';
import { createdGroup, movedGroup, movedProject, renamedGroup, withoutGroup, withSessionInGroup } from '../../../src/shared/grouping';
import { withLink } from '../../../src/shared/panels';
import { pathProblem, resolvePathIn } from '../../../src/shared/pathcheck';
import { togglePinned, toggleArchived, withoutSession } from '../../../src/shared/sessionmarks';
import { withText } from '../../../src/shared/text';
import type { ClaudeUiApi } from '../../../src/shared/types';
import { CONFIG_ROOT, HOME, type BridgeCall, type BridgeEvent, type BridgeEventArgs, type BridgeFixture } from './fixture';

/** The stand-in's side for a check: every call the window made, and a way to fire what it subscribed to. */
export interface BridgeControl {
  calls: BridgeCall[];
  /** Call every callback the window subscribed with `name`; answers how many there were, so a check can tell a fired event from one nobody listens to. */
  emit<K extends BridgeEvent>(name: K, ...args: BridgeEventArgs<K>): number;
}

declare global {
  interface Window {
    /** Set by the harness before anything else runs: what the stand-in answers with. */
    __claudeUiFixture: BridgeFixture;
    __claudeUiTest: BridgeControl;
  }
}

/**
 * The main process as the window's checks see it: `window.claudeUi`, TYPED as the bridge, so a call added, renamed or reshaped in `ClaudeUiApi` fails the type check here instead of leaving a check passing against an API the app no longer has.
 * It answers from the fixture, and only where its answer is main's: a call it does not model REJECTS, naming itself, so a check that reaches one fails instead of running on an invented answer.
 * A check that needs one models it here, against what main does.
 */
export function createBridge(fixture: BridgeFixture): { api: ClaudeUiApi; control: BridgeControl } {
  const calls: BridgeCall[] = [];
  const listeners = new Map<BridgeEvent, ((...args: never[]) => void)[]>();

  // A copy, as IPC hands one: the window must not be able to reach into the fixture through what it was given.
  const answer = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));
  const unmodelled =
    (name: keyof ClaudeUiApi) =>
    (): Promise<never> =>
      Promise.reject(new Error(`The renderer checks' stand-in does not model ${name}; model it in test/renderer/support/bridge.ts against what main does.`));
  // Recorded, and nothing else: what main does with it reaches the window, if at all, as a later event, which a check fires itself.
  const sent = (): void => {};
  const on =
    (name: BridgeEvent) =>
    (callback: (...args: never[]) => void): void => {
      listeners.set(name, [...(listeners.get(name) ?? []), callback]);
    };

  // Main's ids for the ptys it starts: a counter, and nothing the window reads into beyond each being its own.
  let terminals = 0;
  /** The generation of every fixture transcript's one read: main numbers each read from the start, and the window only ever compares it with the one it holds. */
  const READ = 1;

  const api: ClaudeUiApi = {
    listSessions: () => answer(fixture.sessions),
    // Where the answer starts is main's own rule, `readFrom`; a fixture transcript never changes after its one read, so nothing in it is ever marked as changed.
    // A session the listing does not have has no transcript, which is main's empty answer; one it has needs its history in the fixture.
    getHistory: (id, known, generation) => {
      if (!(id in fixture.history)) return fixture.sessions.some((s) => s.id === id) ? unmodelled('getHistory')() : answer(NO_TRANSCRIPT);
      const exchanges = fixture.history[id];
      const from = readFrom(known, exchanges.length, generation === READ, null);
      return answer({ generation: READ, from, exchanges: exchanges.slice(from), total: exchanges.length });
    },
    worktreeExists: unmodelled('worktreeExists'),
    onSessionsChanged: on('onSessionsChanged'),
    onQuitting: on('onQuitting'),
    onClaudeMissing: on('onClaudeMissing'),
    getPinned: () => answer(fixture.pinned),
    // The marks are main's own rules (src/shared/sessionmarks.ts), kept in the fixture, so a later read answers with what the change left.
    togglePin: (id) => answer((fixture.pinned = togglePinned(fixture.pinned, id))),
    getHistoryPins: () => answer(fixture.historyPins),
    toggleHistoryPin: unmodelled('toggleHistoryPin'),
    getArchived: () => answer(fixture.archived),
    toggleArchive: (id) => answer((fixture.archived = toggleArchived(fixture.archived, id, Date.now()))),
    // Main moves the transcript to the trash, so the listing no longer has it, and forgets its marks and its status.
    // What else it forgets (its open tab, the tab to reopen on, its group) the window never reads back while it runs.
    // A panel row linked to it is forgotten with an event the stand-in does not fire, so that delete is main's to answer, not this.
    deleteSession: (id) => {
      if (Object.values(fixture.panelData).some((data) => Object.hasOwn(data.sessions, id))) return unmodelled('deleteSession')();
      fixture.sessions = fixture.sessions.filter((s) => s.id !== id);
      Object.assign(fixture, withoutSession(fixture, id));
      delete fixture.statuses[id];
      return answer(undefined);
    },
    getOpenSessions: () => answer(fixture.openSessions),
    setOpenSessions: sent,
    getActiveSession: () => answer(fixture.activeSession),
    getActiveSessionByProject: () => answer(fixture.activeSessionByProject),
    setActiveSession: sent,
    getActiveProject: () => answer(fixture.activeProject),
    setActiveProject: sent,
    getNotes: () => answer(fixture.notes),
    setNote: (id, note) => answer((fixture.notes = withText(fixture.notes, id, note))),
    getUiState: () => answer(fixture.uiState),
    setUiState: sent,
    getSettings: () => answer(fixture.settings),
    setSettings: unmodelled('setSettings'),
    getWindowChrome: () => answer(fixture.windowChrome),
    minimizeWindow: sent,
    toggleMaximizeWindow: sent,
    closeWindow: sent,
    startWindowResize: sent,
    resizeWindowBy: sent,
    endWindowResize: sent,
    onWindowMaximized: on('onWindowMaximized'),
    getProjectNames: () => answer(fixture.projectNames),
    // Where sessions sit is main's own rules too (src/shared/grouping.ts), kept in the fixture the same way; a new group's id is minted here, as main mints it.
    setProjectName: (repoRoot, name) => answer((fixture.projectNames = withText(fixture.projectNames, repoRoot, name))),
    getGroupState: () => answer(fixture.groupState),
    createGroup: (name, repoRoot, sessionId) => answer((fixture.groupState = createdGroup(fixture.groupState, crypto.randomUUID(), name, repoRoot, sessionId))),
    renameGroup: (id, name) => answer((fixture.groupState = renamedGroup(fixture.groupState, id, name))),
    deleteGroup: (id) => answer((fixture.groupState = withoutGroup(fixture.groupState, id))),
    moveSessionToGroup: (sessionId, groupId) => answer((fixture.groupState = withSessionInGroup(fixture.groupState, sessionId, groupId))),
    moveGroup: (id, move) => answer((fixture.groupState = movedGroup(fixture.groupState, id, move))),
    getProjectOrder: () => answer(fixture.projectOrder),
    // Main's answer only where it has one without deciding anything: every root already has a slot, so the order comes back as it was (`seedProjectOrder` in src/main/meta.ts). Seeding a first order, or putting new roots in front, is main's rule to keep, not a copy's.
    seedProjectOrder: (roots) => {
      const known = new Set(fixture.projectOrder);
      const settled = fixture.projectOrder.length > 0 ? roots.every((root) => known.has(root)) : roots.length === 0;
      return settled ? answer(fixture.projectOrder) : unmodelled('seedProjectOrder')();
    },
    moveProject: (repoRoot, move) => answer((fixture.projectOrder = movedProject(fixture.projectOrder, repoRoot, move) ?? fixture.projectOrder)),
    // Main writes the pairing to its audit log and answers nothing, deciding nothing (`recordClear` in src/main/meta.ts).
    recordClear: () => answer(undefined),
    pickFolder: () => answer(fixture.pickFolder),
    openExternal: sent,
    getAllStatuses: () => answer(fixture.statuses),
    onSessionStatus: on('onSessionStatus'),
    onSessionModel: on('onSessionModel'),
    clearStatus: sent,
    // A claude that has started and printed nothing yet: its tab boots until a check fires `onTerminalData` for it.
    startTerminal: () => answer(++terminals),
    // A shell that has started and printed nothing yet, in the same id space as a claude, as main's are.
    startShell: () => answer(++terminals),
    onTerminalData: on('onTerminalData'),
    onTerminalExit: on('onTerminalExit'),
    sendTerminalInput: sent,
    resizeTerminal: sent,
    killTerminal: sent,
    closeTerminal: sent,
    getLayout: () => answer(fixture.layout),
    // Main's two rules, where it points and what is wrong with what is there; what is there is the fixture's table in place of main's look at the disk.
    checkPath: (value, base, must) => {
      const resolved = resolvePathIn(value, base, HOME, CONFIG_ROOT);
      return answer({ path: resolved, problem: pathProblem(value, must, fixture.paths[resolved] ?? 'missing') });
    },
    onLayoutChanged: on('onLayoutChanged'),
    runPanel: sent,
    stopPanel: sent,
    onPanelRun: on('onPanelRun'),
    getPanelData: (entryId) => (entryId in fixture.panelData ? answer(fixture.panelData[entryId]) : unmodelled('getPanelData')()),
    // Main records the link and the group it was filed in (`withLink`, src/shared/panels.ts), kept in the fixture, and answers with the panel's data; it pushes the same data too, which the window already has from the answer.
    // Main also forgets the links of sessions that are gone, which is its look at the disk, so a panel whose data names a session the fixture does not list is main's to answer, not this.
    linkPanelSession: (entryId, sessionId, link, filed) => {
      const data = fixture.panelData[entryId] ?? { sessions: {}, lastGroup: {} };
      if (Object.keys(data.sessions).some((id) => !fixture.sessions.some((s) => s.id === id))) return unmodelled('linkPanelSession')();
      return answer((fixture.panelData[entryId] = withLink(data, sessionId, link, filed, new Date().toISOString())));
    },
    onPanelDataChanged: on('onPanelDataChanged'),
    getFolders: () => answer(fixture.folders),
    openFolder: sent,
    log: sent,
  };

  // Every call is written down as it arrives, before it is answered.
  const recorded = Object.fromEntries(
    (Object.entries(api) as [keyof ClaudeUiApi, (...args: unknown[]) => unknown][]).map(([name, call]) => [
      name,
      (...args: unknown[]) => {
        calls.push({ name, args: args.map((arg) => (typeof arg === 'function' ? '<callback>' : structuredClone(arg))) });
        return call(...args);
      },
    ]),
  ) as unknown as ClaudeUiApi;

  const control: BridgeControl = {
    calls,
    emit: (name, ...args) => {
      const found = listeners.get(name) ?? [];
      for (const callback of found) (callback as (...values: unknown[]) => void)(...args);
      return found.length;
    },
  };
  return { api: recorded, control };
}
