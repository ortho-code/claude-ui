import { store, withMember } from './app';

/**
 * Which projects the live strip hides: counted on its Hidden line rather than listed, kept for the next launch.
 * Hidden by the eye on a project's heading in the strip, and shown again by picking it from the Hidden line's menu, or by your opening or starting a session there, wherever you do it (`showInStrip`).
 * A launch restoring the tabs and a project switch selecting one are not an open: a restart bringing a hidden project's paused tabs back is what the hide is for.
 */

/** Hide a project from the strip, or show it again. */
export function hideFromStrip(repoRoot: string, hidden: boolean): void {
  store.set({ stripHidden: withMember(store.get().stripHidden, repoRoot, hidden) });
}

/** A session of this project was opened or started by you: the project is in hand again, so the strip lists it. */
export function showInStrip(repoRoot: string): void {
  hideFromStrip(repoRoot, false);
}
