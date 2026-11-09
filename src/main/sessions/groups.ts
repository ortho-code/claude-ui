import { randomUUID } from 'node:crypto';
import type { GroupState, OrderMove } from '../../shared/types';
import { createdGroup, movedGroup, movedProject, renamedGroup, seededOrder, withoutGroup, withSessionInGroup } from '../../shared/sessions/grouping';
import { withText } from '../../shared/helpers/text';
import { readMeta, serialize, update, writeAudited, type Meta } from './metastore';

export function getProjectNames(): Promise<Record<string, string>> {
  return serialize(async () => (await readMeta()).projectNames);
}

// Set a project's display-name override (blank clears it, reverting to the folder name).
export function setProjectName(repoRoot: string, name: string): Promise<Record<string, string>> {
  return update('setProjectName', (meta) => {
    meta.projectNames = withText(meta.projectNames, repoRoot, name);
    return meta.projectNames;
  });
}

// A group is a user-made sub-section inside one project.
// Membership is one group per session, so `groupOf` alone is the whole truth: a session cannot be in two groups by construction.
// Every mutation returns the WHOLE state, since the registry and the membership only make sense together.

function groupState(meta: Meta): GroupState {
  return { groups: meta.groups, groupOf: meta.groupOf };
}

export function getProjectOrder(): Promise<string[]> {
  return serialize(async () => (await readMeta()).projectOrder);
}

/**
 * Give every root a slot and return the order (`seededOrder`, src/shared/sessions/grouping.ts, which the window's checks answer with too).
 * An EMPTY order is seeded from `roots` exactly as given (the caller passes them in the order they already appear, so the run that introduced this changed nothing on screen); an existing order gets unknown roots at the FRONT, so a project that shows up later is somewhere you'll see it.
 * One rule: every root in front of an empty order is the roots as given.
 *
 * Absent roots are NOT pruned.
 * A root is absent once no listed session resolves to it, such as when its sessions were all deleted (finished ones are still listed: the caller seeds from the raw listing), and forgetting its slot would make it leap to the top when a session appears there again — the opposite of the stable order this exists to provide.
 */
export function seedProjectOrder(roots: string[]): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const seeded = seededOrder(meta.projectOrder, roots);
    if (!seeded) return meta.projectOrder; // nothing new: no write at all
    meta.projectOrder = seeded;
    await writeAudited('seedProjectOrder', meta);
    return meta.projectOrder;
  });
}

// Reorder one project among the ones on screen (`shown`, the window's to say); a move that goes nowhere writes nothing.
export function moveProject(repoRoot: string, move: OrderMove, shown: string[]): Promise<string[]> {
  return serialize(async () => {
    const meta = await readMeta();
    const moved = movedProject(meta.projectOrder, repoRoot, move, shown);
    if (!moved) return meta.projectOrder;
    meta.projectOrder = moved;
    await writeAudited('moveProject', meta);
    return meta.projectOrder;
  });
}

export function getGroupState(): Promise<GroupState> {
  return serialize(async () => groupState(await readMeta()));
}

/** A group change applied: the rule's new state kept, and handed back. */
function setGroupState(meta: Meta, next: GroupState): GroupState {
  meta.groups = next.groups;
  meta.groupOf = next.groupOf;
  return groupState(meta);
}

// The rules for each change are in src/shared/sessions/grouping.ts.
export function createGroup(name: string, repoRoot: string | null, sessionId?: string): Promise<GroupState> {
  return update('createGroup', (meta) => setGroupState(meta, createdGroup(groupState(meta), randomUUID(), name, repoRoot, sessionId)));
}

export function renameGroup(id: string, name: string): Promise<GroupState> {
  return update('renameGroup', (meta) => setGroupState(meta, renamedGroup(groupState(meta), id, name)));
}

export function deleteGroup(id: string): Promise<GroupState> {
  return update('deleteGroup', (meta) => setGroupState(meta, withoutGroup(groupState(meta), id)));
}

export function moveGroup(id: string, move: OrderMove): Promise<GroupState> {
  return update('moveGroup', (meta) => setGroupState(meta, movedGroup(groupState(meta), id, move)));
}

/** Move sessions into a group, or out of any group with a null `groupId`, in one write. */
export function moveSessionsToGroup(sessionIds: string[], groupId: string | null): Promise<GroupState> {
  return update('moveSessionsToGroup', (meta) => setGroupState(meta, sessionIds.reduce((state, id) => withSessionInGroup(state, id, groupId), groupState(meta))));
}
