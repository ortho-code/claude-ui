import { defaultSettings, defaultUi } from '../../../src/shared/defaults';
import type { FolderName } from '../../../src/shared/folders';
import type { LayoutReport, PanelData } from '../../../src/shared/panels';
import type { ClaudeUiApi, Exchange, GroupState, HistoryPin, SessionSummary, Settings, UiState, WindowChrome } from '../../../src/shared/types';

/**
 * What the stand-in for the main process answers with: plain data, because it crosses into the page as JSON.
 * One field per thing main keeps, named after the call that reads it.
 */
export interface BridgeFixture {
  sessions: SessionSummary[];
  pinned: string[];
  archived: Record<string, number>;
  notes: Record<string, string>;
  openSessions: string[];
  activeSession: string | null;
  activeSessionByProject: Record<string, string>;
  activeProject: string | null;
  uiState: UiState;
  settings: Settings;
  windowChrome: WindowChrome;
  projectNames: Record<string, string>;
  groupState: GroupState;
  projectOrder: string[];
  statuses: Record<string, string>;
  historyPins: Record<string, HistoryPin>;
  /** Session id -> its transcript's exchanges, as main reads them; a listed session left out has no history the stand-in can answer for, and one the listing does not have has no transcript yet. */
  history: Record<string, Exchange[]>;
  layout: LayoutReport;
  folders: Record<FolderName, string>;
  panelData: Record<string, PanelData>;
}

/** One call the window made, as it arrived; a callback argument is recorded as the string `<callback>`. */
export interface BridgeCall {
  name: keyof ClaudeUiApi;
  args: unknown[];
}

/** The subscriptions a check can fire, by the name the window subscribes with. */
export type BridgeEvent = Extract<keyof ClaudeUiApi, `on${string}`>;
export type BridgeEventArgs<K extends BridgeEvent> = Parameters<Parameters<ClaudeUiApi[K]>[0]>;

export const HOME = '/home/tester';
export const PROJECT = `${HOME}/projects/demo`;
export const CONFIG_ROOT = `${HOME}/.config/claude-ui/config`;

/** A session in the demo project, with whatever a check needs different. */
export function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  const id = overrides.id ?? '00000000-0000-4000-8000-000000000001';
  return {
    id,
    conversationId: `conversation-${id}`,
    cwd: PROJECT,
    repoRoot: PROJECT,
    isRepo: true,
    worktree: '',
    title: 'A session',
    firstMessage: 'Hello',
    model: 'claude-opus-5-5',
    lastActivity: '2026-09-30T08:00:00.000Z',
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
    cwdExists: true,
    repoRootExists: true,
    ...overrides,
  };
}

/**
 * A first run with one session and no layout file: the default layout, nothing pinned, open or filtered.
 * One session because without one the window drops the stored project, and every panel then says "Pick a project".
 * The `uiState` and `settings` are main's own first-run state, the functions both use.
 */
export function defaultFixture(): BridgeFixture {
  const one = session();
  return {
    sessions: [one],
    pinned: [],
    archived: {},
    notes: {},
    openSessions: [],
    activeSession: null,
    activeSessionByProject: {},
    activeProject: one.repoRoot,
    uiState: defaultUi(),
    settings: defaultSettings(),
    windowChrome: { own: false, maximized: false, title: 'Claude UI (test)', version: '0.0.0-test', dev: true },
    projectNames: {},
    groupState: { groups: [], groupOf: {} },
    projectOrder: [one.repoRoot],
    statuses: {},
    historyPins: {},
    history: {},
    layout: { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, status: 'missing', error: null, json: null, types: [] },
    folders: { config: CONFIG_ROOT, logs: `${HOME}/.config/claude-ui/logs` },
    panelData: {},
  };
}
