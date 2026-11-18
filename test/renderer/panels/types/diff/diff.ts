import type { Locator, Page } from '@playwright/test';
import { DEFAULT_DIFF_PICKS, type DiffFile, type DiffPicks, type DiffQuestion, type DiffRow, type DiffSummary, type FileDiff } from '../../../../../src/shared/diff/types';
import type { LayoutReport, PanelData } from '../../../../../src/shared/panels';
import type { SessionSummary } from '../../../../../src/shared/types';
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

/** The layout: the sidebar, the terminal area, the Editor at `width` beside it, and a diff panel on the right; the Editor switched off when `editorOff`. */
export const diffLayout = (width: string, editorOff: boolean): Partial<BridgeFixture> & { layout: LayoutReport } =>
  withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'editor', size: width, panels: [{ id: 'files', type: 'editor', ...(editorOff ? { hidden: true } : {}) }] },
        { id: 'right', size: '360px', panels: [{ id: 'changes', type: 'diff' }] },
      ],
    },
  });

/** What a panel's own file keeps when only its diff picks are set. */
export const picksData = (picks: Partial<DiffPicks>): PanelData => ({ sessions: {}, lastGroup: {}, diff: { ...DEFAULT_DIFF_PICKS, ...picks } });

/**
 * Boot with the project's session on show, the Editor and the diff panel beside it, and main answering each question from `diffs`.
 * `data` is what the diff panel's own file keeps and `editorData` the Editor's, `tree` the project's working tree's fingerprint, `files` each file's diff by path, `width` the Editor's, `editorOff` the Editor switched off, and `also` a second session of the project open in a tab of its own.
 */
export async function bootDiff(
  app: App,
  diffs: Partial<Record<DiffQuestion, DiffSummary>>,
  options: { data?: PanelData; editorData?: PanelData; width?: string; editorOff?: boolean; tree?: string; files?: Record<string, FileDiff>; also?: SessionSummary } = {},
): Promise<void> {
  const also = options.also ? [options.also] : [];
  await app.boot({
    ...diffLayout(options.width ?? '480px', options.editorOff === true),
    sessions: [here, ...also],
    openSessions: [here.id, ...also.map((each) => each.id)],
    activeSession: here.id,
    history: Object.fromEntries([here, ...also].map((each) => [each.id, []])),
    diffs: { [PROJECT]: diffs },
    fileDiffs: { [PROJECT]: options.files ?? {} },
    panelData: { ...(options.data ? { changes: options.data } : {}), ...(options.editorData ? { files: options.editorData } : {}) },
    ...(options.tree ? { trees: { [PROJECT]: options.tree } } : {}),
  });
}

/**
 * A file's diff from lines as a unified diff writes them, ` ` kept, `-` removed, `+` added, each hunk starting at the old and new lines it names, and the file as it is on disk.
 * Line numbers count on from each hunk's start.
 */
export function fileDiff(path: string, hunks: { old: number; new: number; heading?: string; rows: string[] }[], lines: string[] | null = null): FileDiff {
  let oldEnd = 1;
  return {
    path,
    binary: false,
    lines,
    hunks: hunks.map((hunk) => {
      let old = hunk.old;
      let now = hunk.new;
      const rows: DiffRow[] = hunk.rows.map((line) => {
        const text = line.slice(1);
        if (line.startsWith('-')) return { kind: 'del', old: old++, new: null, text };
        if (line.startsWith('+')) return { kind: 'add', old: null, new: now++, text };
        return { kind: 'context', old: old++, new: now++, text };
      });
      const gapBefore = hunk.old - oldEnd;
      oldEnd = old;
      return { oldStart: hunk.old, newStart: hunk.new, heading: hunk.heading ?? '', gapBefore, rows };
    }),
  };
}

export const editor = (page: Page): Locator => page.locator('.editor-panel');
export const diffLines = (page: Page): Locator => editor(page).locator('.diff-hunks .diff-line');
export const fileNote = (page: Page): Locator => editor(page).locator('.diff-file-note');
export const position = (page: Page): Locator => editor(page).locator('.diff-position');
/** The Editor's tabs, in its header. */
export const editorTabs = (page: Page): Locator => page.locator('.panel-group', { has: page.locator('.editor-panel') }).locator('.panel-tabs .tab');

export const panel = (page: Page): Locator => page.locator('.diff-panel');
export const rows = (page: Page): Locator => panel(page).locator('.list-row');
export const note = (page: Page): Locator => panel(page).locator('.diff-note');
export const questionButton = (page: Page): Locator => panel(page).locator('.diff-question');
export const menuRows = (page: Page): Locator => page.locator('.kebab-menu button.menu-row');
