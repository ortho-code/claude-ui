import type { GroupState, SessionSummary } from '../../shared/types';
import { entityKey } from '../logic';
import { store } from './app';

/**
 * The group writes both surfaces make: the session list's menus, and the terminal area filing a new session, a fork or a cleared session's successor where its work belongs.
 * Every mutation goes through the main process and hands back the whole state, so the renderer never second-guesses what changed — it swaps its copy, and the list and the tab bar, which both draw groups, follow the store.
 */

export function applyGroupState(next: GroupState): void {
  store.set({ groupState: next });
}

/** File sessions in a group, or in none for null, in one write: the one route for it, by the sessions' ids for a caller that holds no summary, such as a cleared session's successor. */
export async function moveSessionsToGroup(ids: readonly string[], groupId: string | null): Promise<void> {
  applyGroupState(await window.claudeUi.moveSessionsToGroup([...ids], groupId));
}

export async function moveSessionToGroupById(id: string, groupId: string | null): Promise<void> {
  await moveSessionsToGroup([id], groupId);
}

export async function moveSessionToGroup(session: SessionSummary, groupId: string | null): Promise<void> {
  await moveSessionToGroupById(entityKey(session), groupId);
}
