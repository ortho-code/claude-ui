import { fromMarkup } from '../../../dom';
import { store, withMember, type StoredView } from '../../../state/app';
import './read.css';

/**
 * THE FULL READ of what the session list draws from main, set in one change, with the loading bar the sidebar shows meanwhile.
 * Start-up asks for it, and so does a row's delete, since main's delete also forgets the session's pins, notes and group.
 */

/** The loading bar, built here and placed by the sidebar (index.ts) above the list. */
export const loadingEl = fromMarkup(`<div id="loading"></div>`);

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

interface FullRead {
  /** Show the loading bar while it reads. */
  showLoading?: boolean;
  /** A session whose delete just resolved, which stops being hidden in the same change as the re-read. */
  revealed?: string;
  /** Start-up's read, which also takes the project you were in and the view you left (`restoreUiState`): in the same change, so the first draw is already scoped and filtered rather than drawn for All, whole, first. */
  startUp?: StoredView;
}

/**
 * A full read of what the list draws from main, set in one change.
 * Start-up's is written whole: nothing can have written those slices before the first draw but a status event from a claude a crashed launch left running, and leaving its statuses out for that one event would cost every other session's, which only this read has.
 * Any later one is written as of when it asked (`readAt`), so a status, a pin or a listing that landed while it was out is not put back to what it read.
 */
export async function fullRead({ showLoading = true, revealed, startUp }: FullRead = {}): Promise<void> {
  if (showLoading) setLoading(true);
  try {
    const readAt = store.stamp();
    const [sessions, pinnedList, archivedList, statusMap, namesMap, noteMap, groupState, storedProject] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getArchived(),
      window.claudeUi.getAllStatuses(),
      window.claudeUi.getProjectNames(),
      window.claudeUi.getNotes(),
      window.claudeUi.getGroupState(),
      startUp ? window.claudeUi.getActiveProject() : null,
    ]);
    // Seed from the RAW list (archived included — the transcript still exists), so a project whose sessions are all archived still holds a slot.
    // Writes only when a root is genuinely new, so the common case costs one read.
    // Recency order is what seeds the very first run.
    const projectOrder = await window.claudeUi.seedProjectOrder([...new Set(sessions.map((s) => s.repoRoot))]);
    store.batch(() => {
      store.set(
        {
          sessions,
          statuses: new Map(Object.entries(statusMap)),
          pinned: new Set(pinnedList),
          archived: new Map(Object.entries(archivedList)),
          notes: new Map(Object.entries(noteMap)),
          groupState,
          projectNames: new Map(Object.entries(namesMap)),
          projectOrder,
          ...(startUp ? { activeProject: storedProject, ...startUp } : {}),
        },
        startUp ? undefined : { readAt },
      );
      // In the same change, so a row whose files are gone never shows for a moment between no longer hiding it and the listing without it.
      // Whatever listing that is: one that landed while this read was out was asked after the delete too, which is why this one was left out.
      if (revealed !== undefined) store.set({ pendingDeletes: withMember(store.get().pendingDeletes, revealed, false) });
    });
  } finally {
    if (showLoading) setLoading(false);
  }
}
