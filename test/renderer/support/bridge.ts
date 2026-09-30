import { readFrom } from '../../../src/shared/history';
import type { ClaudeUiApi } from '../../../src/shared/types';
import type { BridgeCall, BridgeEvent, BridgeEventArgs, BridgeFixture } from './fixture';

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
    getHistory: (id, known, generation) => {
      if (!(id in fixture.history)) return unmodelled('getHistory')();
      const exchanges = fixture.history[id];
      const from = readFrom(known, exchanges.length, generation === READ, null);
      return answer({ generation: READ, from, exchanges: exchanges.slice(from), total: exchanges.length });
    },
    worktreeExists: unmodelled('worktreeExists'),
    onSessionsChanged: on('onSessionsChanged'),
    onQuitting: on('onQuitting'),
    onClaudeMissing: on('onClaudeMissing'),
    getPinned: () => answer(fixture.pinned),
    togglePin: unmodelled('togglePin'),
    getHistoryPins: () => answer(fixture.historyPins),
    toggleHistoryPin: unmodelled('toggleHistoryPin'),
    getArchived: () => answer(fixture.archived),
    toggleArchive: unmodelled('toggleArchive'),
    deleteSession: unmodelled('deleteSession'),
    getOpenSessions: () => answer(fixture.openSessions),
    setOpenSessions: sent,
    getActiveSession: () => answer(fixture.activeSession),
    getActiveSessionByProject: () => answer(fixture.activeSessionByProject),
    setActiveSession: sent,
    getActiveProject: () => answer(fixture.activeProject),
    setActiveProject: sent,
    getNotes: () => answer(fixture.notes),
    setNote: unmodelled('setNote'),
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
    setProjectName: unmodelled('setProjectName'),
    getGroupState: () => answer(fixture.groupState),
    createGroup: unmodelled('createGroup'),
    renameGroup: unmodelled('renameGroup'),
    deleteGroup: unmodelled('deleteGroup'),
    moveSessionToGroup: unmodelled('moveSessionToGroup'),
    moveGroup: unmodelled('moveGroup'),
    getProjectOrder: () => answer(fixture.projectOrder),
    // Main's answer only where it has one without deciding anything: every root already has a slot, so the order comes back as it was (`seedProjectOrder` in src/main/meta.ts). Seeding a first order, or putting new roots in front, is main's rule to keep, not a copy's.
    seedProjectOrder: (roots) => {
      const known = new Set(fixture.projectOrder);
      const settled = fixture.projectOrder.length > 0 ? roots.every((root) => known.has(root)) : roots.length === 0;
      return settled ? answer(fixture.projectOrder) : unmodelled('seedProjectOrder')();
    },
    moveProject: unmodelled('moveProject'),
    recordClear: unmodelled('recordClear'),
    pickFolder: unmodelled('pickFolder'),
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
    checkPath: unmodelled('checkPath'),
    onLayoutChanged: on('onLayoutChanged'),
    runPanel: sent,
    stopPanel: sent,
    onPanelRun: on('onPanelRun'),
    getPanelData: (entryId) => (entryId in fixture.panelData ? answer(fixture.panelData[entryId]) : unmodelled('getPanelData')()),
    linkPanelSession: unmodelled('linkPanelSession'),
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
