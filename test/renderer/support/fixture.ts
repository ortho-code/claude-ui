import { defaultUi } from '../../../src/shared/defaults';
import type { FolderName } from '../../../src/shared/folders';
import type { LayoutReport, LocalLayoutRead, NodeState, PanelData } from '../../../src/shared/panels';
import type { Found } from '../../../src/shared/pathcheck';
import type { SettingsFileRead } from '../../../src/shared/settings';
import type { ClaudeUiApi, Exchange, GroupState, HistoryPin, SessionSummary, UiState, WindowChrome } from '../../../src/shared/types';

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
  /** The two settings files as main reads them (shared/settings.ts); a save writes into `app`'s `json`. */
  settings: { yours: SettingsFileRead; app: SettingsFileRead };
  windowChrome: WindowChrome;
  projectNames: Record<string, string>;
  groupState: GroupState;
  projectOrder: string[];
  statuses: Record<string, string>;
  historyPins: Record<string, HistoryPin>;
  /** Session id -> its transcript's exchanges, as main reads them; a listed session left out has no history the stand-in can answer for, and one the listing does not have has no transcript yet. */
  history: Record<string, Exchange[]>;
  /** The layout file, and the app's beside it in `local`, which a save of the window's state writes into, as main's does. */
  layout: LayoutReport;
  folders: Record<FolderName, string>;
  panelData: Record<string, PanelData>;
  /**
   * What is at each absolute path, as main would find it on disk.
   * A path left out is not there, but for the folders the listing names as there and the one the folder picker answers, which are folders unless listed here otherwise: a check makes one vanish while the window runs by setting it to `missing`.
   */
  paths: Record<string, Found>;
  /** The folder chosen in main's folder dialog; null, as main answers for one cancelled. */
  pickFolder: string | null;
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
    leftWorktree: '',
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

/** The app's file beside the layout as main reads it when there is none, with the tree's state from `meta.json` already moved, so a check that is not about the move makes none. */
export const noLocalLayout = (): LocalLayoutRead => ({ file: `${CONFIG_ROOT}/layouts/default.local.json`, status: 'missing', error: null, json: null, byApp: false, stateMoved: true });

/** That file holding `nodes`, as a person or an earlier run left it. */
export const localLayoutWith = (nodes: Record<string, NodeState>): LocalLayoutRead => ({ ...noLocalLayout(), status: 'read', json: { nodes } });

/** A settings file that is not there, as main reads one. */
export const noSettingsFile = (name: string): SettingsFileRead => ({ name, status: 'missing', error: null, json: null });

/** A settings file holding `json`, as main reads one. */
export const settingsFileWith = (name: string, json: unknown): SettingsFileRead => ({ name, status: 'read', error: null, json });

/** The titles of `sessions`, sorted: what a check expects the list to show, against `sortedTitles`. */
export const sorted = (...sessions: { title: string }[]): string[] => sessions.map((s) => s.title).sort();

/**
 * A first run with one session and no layout file: the default layout, nothing pinned, open or filtered.
 * One session because without one the window drops the stored project, and every panel then says "Pick a project".
 * The `uiState` is main's own first-run state, the function both use; neither settings file is there.
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
    settings: { yours: noSettingsFile('settings.json'), app: noSettingsFile('settings.local.json') },
    windowChrome: { own: false, maximized: false, title: 'Claude UI (test)', version: '0.0.0-test', dev: true },
    projectNames: {},
    groupState: { groups: [], groupOf: {} },
    projectOrder: [one.repoRoot],
    statuses: {},
    historyPins: {},
    history: {},
    layout: { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, status: 'missing', error: null, json: null, types: [], local: noLocalLayout() },
    folders: { config: CONFIG_ROOT, logs: `${HOME}/.config/claude-ui/logs` },
    panelData: {},
    paths: {},
    pickFolder: null,
  };
}
