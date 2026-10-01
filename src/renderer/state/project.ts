import { store } from './app';
import { foldsWith } from './folds';

/**
 * The project on show, written the one way both of its writers make it: the switcher choosing a project, and the terminal area dropping to All so a new tab in another project comes into view.
 * The store's selection, the project opened if it was folded in the All view, and main told, which keeps it for the next launch.
 */
export function setProjectOnShow(repoRoot: string | null): void {
  store.set({ activeProject: repoRoot, ...(repoRoot ? { folds: foldsWith(store.get(), 'projects', [repoRoot], false) } : {}) });
  window.claudeUi.setActiveProject(repoRoot);
}
