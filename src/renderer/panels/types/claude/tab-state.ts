import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { store, type TabState } from '../../../state/app';
import { fromMarkup } from '../../../ui/dom';

/** Where the tabs' terminals go: built here, and placed by the pane (pane.ts) under the tab bar. */
export const terminalsEl = fromMarkup(`<div id="terminals"></div>`);

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
export const terminals = new Map<string, TabTerminal>();

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

/**
 * Where you were, per project and overall.
 * Seeded from meta at restore and kept current as you switch, so returning to a project lands where you left it even across a restart — `activatedSeq` alone cannot do that, since it resets to 0 when tabs are rebuilt.
 */
export const remembered: { byProject: Record<string, string>; last: string | null } = { byProject: {}, last: null };

/** Each stopping tab's pending steps, its control becoming a force and its saying claude has not left, so a stop that ends, is called off or is forced takes them with it. */
export const stopTimers = new Map<string, ReturnType<typeof setTimeout>[]>();

export function clearStopTimers(token: string): void {
  for (const timer of stopTimers.get(token) ?? []) clearTimeout(timer);
  stopTimers.delete(token);
}

/**
 * What a tab keeps of its session's tasks once its claude has gone, by a stop or a quit: what comes back when the session is opened again, its crons, since a `/loop` wakeup ends with the session (`afterStop`); null for none.
 * A claude that went before it reported at all leaves what the tab already kept from the stop before, which is still all that is known.
 */
export function keptWhenGone(tab: TabState): TabState['scheduledWhenStopped'] {
  const live = store.get().scheduledTasks.get(tab.session.id);
  const kept = live ? live.filter((task) => task.cron !== null) : tab.scheduledWhenStopped;
  return kept && kept.length > 0 ? kept : null;
}
