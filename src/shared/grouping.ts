import type { GroupState, OrderMove, SessionGroup } from './types';

/**
 * Main's rules for where sessions sit — the projects in the order you set, and the groups inside a project — pure, so that the window's checks answer them the way main does.
 * Main (src/main/meta.ts) applies them inside its serialised writes of `meta.json`; a project's name is written with `withText` (src/shared/text.ts).
 * Every group change hands back the WHOLE state, since the registry and the membership only make sense together, and never changes the one it was given.
 */

/**
 * Where an ordering move lands, given the current index and the last one.
 * Null when the move would fall off an end or change nothing, so a caller can skip the write entirely rather than silently clamping onto a no-op.
 * Shared by groups and projects so both obey identical rules.
 */
export function moveTarget(from: number, last: number, move: OrderMove): number | null {
  const to = move === 'top' ? 0 : move === 'bottom' ? last : move === 'up' ? from - 1 : from + 1;
  if (to < 0 || to > last || to === from) return null;
  return to;
}

/** The project order with one project moved, or null when it does not move: a root nobody has seen has no slot, since the order is seeded from what is on disk. */
export function movedProject(order: readonly string[], repoRoot: string, move: OrderMove): string[] | null {
  const from = order.indexOf(repoRoot);
  if (from < 0) return null;
  const to = moveTarget(from, order.length - 1, move);
  if (to === null) return null;
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * A group created at the top of its project, holding `sessionId` when one is given (a row's "New group…" creates and moves at once; the project heading's creates it empty).
 * The id is the caller's to mint. A blank name creates nothing — the caller's dialog can be dismissed empty.
 */
export function createdGroup(state: GroupState, id: string, name: string, repoRoot: string | null, sessionId?: string): GroupState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  const group: SessionGroup = { id, name: trimmed, repoRoot };
  return { groups: [group, ...state.groups], groupOf: sessionId ? { ...state.groupOf, [sessionId]: id } : state.groupOf };
}

/** A group renamed; a blank name is ignored rather than applied, so a group can never become nameless. */
export function renamedGroup(state: GroupState, id: string, name: string): GroupState {
  const trimmed = name.trim();
  if (!trimmed || !state.groups.some((g) => g.id === id)) return state;
  return { ...state, groups: state.groups.map((g) => (g.id === id ? { ...g, name: trimmed } : g)) };
}

/** A group deleted: it leaves the registry and its members go back to sitting under their project. The sessions themselves are never touched. */
export function withoutGroup(state: GroupState, id: string): GroupState {
  return {
    groups: state.groups.filter((g) => g.id !== id),
    groupOf: Object.fromEntries(Object.entries(state.groupOf).filter(([, groupId]) => groupId !== id)),
  };
}

/**
 * A group moved within ITS OWN project.
 * The registry is one flat array shared by every project, so the project's entries are lifted out by the slots they occupy, reordered, and written back into those same slots — which leaves every other project's position in the array untouched.
 */
export function movedGroup(state: GroupState, id: string, move: OrderMove): GroupState {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return state;
  const slots: number[] = [];
  state.groups.forEach((g, i) => {
    if (g.repoRoot === group.repoRoot) slots.push(i);
  });
  const from = slots.findIndex((i) => state.groups[i]!.id === id);
  const to = moveTarget(from, slots.length - 1, move);
  if (to === null) return state;
  const segment = slots.map((i) => state.groups[i]!);
  segment.splice(to, 0, ...segment.splice(from, 1));
  const groups = [...state.groups];
  slots.forEach((slot, n) => {
    groups[slot] = segment[n]!;
  });
  return { ...state, groups };
}

/**
 * A session moved into a group, or out of every group for null.
 * It is a MOVE: any previous membership is replaced. An unknown group id is ignored rather than stored, so the membership can never name a group that isn't there.
 */
export function withSessionInGroup(state: GroupState, sessionId: string, groupId: string | null): GroupState {
  if (groupId === null) {
    const groupOf = { ...state.groupOf };
    delete groupOf[sessionId];
    return { ...state, groupOf };
  }
  if (!state.groups.some((g) => g.id === groupId)) return state;
  return { ...state, groupOf: { ...state.groupOf, [sessionId]: groupId } };
}
