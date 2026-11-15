import type { Locator, Page } from '@playwright/test';
import type { DiffFile, DiffQuestion, DiffSummary } from '../../../../../src/shared/diff/types';
import type { PanelData } from '../../../../../src/shared/panels';
import { type BridgeFixture, PROJECT } from '../../../support/fixture';
import type { App } from '../../../support/harness';
import { here, withLayout } from '../../layout/layout';

/** A summary as main reads one, with what a check does not name filled in: a base guessed from the remotes and no files. */
export const summary = (over: Partial<DiffSummary> = {}): DiffSummary => ({
  root: PROJECT,
  against: 'aaaaaaa',
  base: { ref: 'upstream/main', source: 'convention' },
  missing: null,
  files: [],
  untrackedLeftOut: 0,
  counts: { ahead: 2, behind: 0, unpushed: 1 },
  ...over,
});

/** A changed file, one line added unless a check says otherwise. */
export const file = (path: string, over: Partial<DiffFile> = {}): DiffFile => ({ path, from: null, status: 'M', added: 1, deleted: 0, binary: false, generated: false, ...over });

/** The layout: the sidebar, the terminal area, and a diff panel on the right, at `width`. */
const layout = (width: string): Partial<BridgeFixture> =>
  withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: width, panels: [{ id: 'changes', type: 'diff' }] },
      ],
    },
  });

/** Boot with the project's session on show, the diff panel beside it, and main answering each question from `diffs`; `data` is what the panel's own file keeps, `tree` the project's working tree's fingerprint. */
export async function bootDiff(app: App, diffs: Partial<Record<DiffQuestion, DiffSummary>>, options: { data?: PanelData; width?: string; tree?: string } = {}): Promise<void> {
  await app.boot({
    ...layout(options.width ?? '360px'),
    sessions: [here],
    openSessions: [here.id],
    activeSession: here.id,
    history: { [here.id]: [] },
    diffs: { [PROJECT]: diffs },
    ...(options.data ? { panelData: { changes: options.data } } : {}),
    ...(options.tree ? { trees: { [PROJECT]: options.tree } } : {}),
  });
}

export const panel = (page: Page): Locator => page.locator('.diff-panel');
export const rows = (page: Page): Locator => panel(page).locator('.list-row');
export const note = (page: Page): Locator => panel(page).locator('.diff-note');
export const questionButton = (page: Page): Locator => panel(page).locator('.diff-question');
export const menuRows = (page: Page): Locator => page.locator('.kebab-menu button.menu-row');
