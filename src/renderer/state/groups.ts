import type { GroupState, SessionSummary } from '../../shared/types';
import { entityKey } from '../logic';
import { store } from './app';

/**
 * The group writes both surfaces make: the session list's menus, and the terminal area filing a new session, a fork or a cleared session's successor where its work belongs.
 * Every mutation goes through the main process and hands back the whole state, so the renderer never second-guesses what changed — it swaps its copy, and the list, the strip and the tab bar, which all draw groups, follow the store.
 */

export function applyGroupState(next: GroupState): void {
  store.set({ groupState: next });
}

/** File a session in a group, or in none for null: the one route for it, by the session's id for a caller that holds no summary, such as a cleared session's successor. */
export async function moveSessionToGroupById(id: string, groupId: string | null): Promise<void> {
  applyGroupState(await window.claudeUi.moveSessionToGroup(id, groupId));
}

export async function moveSessionToGroup(session: SessionSummary, groupId: string | null): Promise<void> {
  await moveSessionToGroupById(entityKey(session), groupId);
}
