import type { Locator, Page } from '@playwright/test';
import { DEFAULT_DIFF_PICKS, type DiffFile, type DiffPicks, type DiffQuestion, type DiffRow, type DiffSummary, type FileDiff, type SessionFileDiff } from '../../../../../src/shared/diff/types';
import type { LayoutReport, PanelData } from '../../../../../src/shared/panels';
import type { EditorUi, Exchange, HistoryUi, SessionSummary } from '../../../../../src/shared/types';
import { defaultUi } from '../../../../../src/shared/config/defaults';
import { type BridgeFixture, PROJECT } from '../../../support/fixture';
import type { App } from '../../../support/harness';
import { here, withLayout } from '../../layout/layout';

/** A summary as main reads one, with what a check does not name filled in: a base guessed from the remotes and no files. */
export const summary = (over: Partial<DiffSummary> = {}): DiffSummary => ({
  root: PROJECT,
  branch: 'feature',
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

/** The layout: the sidebar, the terminal area, the Editor at `width` beside it, and an Explorer on the right with `explorerOptions`; the Editor switched off when `editorOff`. */
const diffLayout = (width: string | null, editorOff: boolean, explorerOptions: Record<string, string> | undefined): Partial<BridgeFixture> & { layout: LayoutReport } =>
  withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        // With no width, the file leaves the Editor out, and the app adds it as it would to anyone's.
        ...(width === null ? [] : [{ id: 'editor', size: width, panels: [{ id: 'files', type: 'editor', ...(editorOff ? { hidden: true } : {}) }] }]),
        { id: 'right', size: '360px', panels: [{ id: 'changes', type: 'explorer', ...(explorerOptions ? { options: explorerOptions } : {}) }] },
      ],
    },
  });

/** What a panel's own file keeps when only its diff picks are set. */
export const picksData = (picks: Partial<DiffPicks>): PanelData => ({ sessions: {}, lastGroup: {}, diff: { ...DEFAULT_DIFF_PICKS, ...picks } });

/**
 * Boot with the project's session on show, the Editor and the Explorer beside it, and main answering each question from `diffs`.
 * `data` is what the Explorer's own file keeps and `editor` what the window keeps of the Editor (docked, how it draws a diff), `tree` the project's working tree's fingerprint, `files` each file's diff by path, `width` the docked Editor's, null to leave it out of the file, `editorOff` the Editor panel switched off, `also` a second session of the project open in a tab of its own, `history` the requests of the session on show, `historyUi` what the window keeps of the history (docked, its width), `as` what the session on show has otherwise than the fixture's, `checkouts` the other checkouts main answers for, each with its questions' answers, its files' diffs and its working tree's fingerprint, `nested` the repositories main finds inside a folder, by the folder, `explorerOptions` the Explorer entry's options, `bases` the branches main offers as a base, what each counts, which repository each checkout is in and what is kept, `sessionFiles` what main reads of a file's changes since the session on show first changed it, by absolute path, and `diskFiles` the files on disk a path a terminal prints resolves to.
 */
export async function bootDiff(
  app: App,
  diffs: Partial<Record<DiffQuestion, DiffSummary>>,
  options: { data?: PanelData; editor?: Partial<EditorUi>; width?: string | null; editorOff?: boolean; tree?: string; files?: Record<string, FileDiff>; also?: SessionSummary; history?: Exchange[]; historyUi?: Partial<HistoryUi>; as?: Partial<SessionSummary>; checkouts?: Record<string, { diffs: Partial<Record<DiffQuestion, DiffSummary>>; files?: Record<string, FileDiff>; tree?: string }>; nested?: Record<string, string[]>; explorerOptions?: Record<string, string>; bases?: Partial<BridgeFixture['bases']>; sessionFiles?: Record<string, SessionFileDiff>; diskFiles?: string[] } = {},
): Promise<void> {
  const also = options.also ? [options.also] : [];
  const shown = { ...here, ...options.as };
  const checkouts = Object.entries(options.checkouts ?? {});
  await app.boot({
    ...diffLayout(options.width === undefined ? '480px' : options.width, options.editorOff === true, options.explorerOptions),
    sessions: [shown, ...also],
    openSessions: [shown.id, ...also.map((each) => each.id)],
    activeSession: shown.id,
    history: Object.fromEntries([shown, ...also].map((each) => [each.id, each === shown ? (options.history ?? []) : []])),
    diffs: { [PROJECT]: diffs, ...Object.fromEntries(checkouts.map(([root, checkout]) => [root, checkout.diffs])) },
    fileDiffs: { [PROJECT]: options.files ?? {}, ...Object.fromEntries(checkouts.map(([root, checkout]) => [root, checkout.files ?? {}])) },
    panelData: options.data ? { changes: options.data } : {},
    nested: options.nested ?? {},
    sessionFiles: { [shown.id]: options.sessionFiles ?? {} },
    diskFiles: options.diskFiles ?? [],
    bases: { candidates: {}, counts: {}, repoOf: {}, kept: {}, gone: [], ...options.bases },
    uiState: { ...defaultUi(), editor: { ...defaultUi().editor, ...options.editor }, history: { ...defaultUi().history, ...options.historyUi } },
    trees: { ...(options.tree ? { [PROJECT]: options.tree } : {}), ...Object.fromEntries(checkouts.flatMap(([root, checkout]) => (checkout.tree ? [[root, checkout.tree]] : []))) },
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

/** The Editor's view, in the drawer or docked. */
export const editor = (page: Page): Locator => page.locator('.editor-view');
/** The Editor panel, where it docks. */
export const editorPanel = (page: Page): Locator => page.locator('.editor-panel');
export const diffLines = (page: Page): Locator => editor(page).locator('.diff-hunks .diff-line');
export const fileNote = (page: Page): Locator => editor(page).locator('.diff-file-note');
/** The sentence in a file's place when it offers a button under it. */
export const fileSentence = (page: Page): Locator => fileNote(page).locator(':scope > div:first-child');
/** The button under that sentence. */
export const fileLift = (page: Page): Locator => fileNote(page).locator('.pane-actions button');
export const position = (page: Page): Locator => editor(page).locator('.diff-position');
/** The Editor's tabs, in its header. */
export const editorTabs = (page: Page): Locator => page.locator('.editor-view .panel-tabs .tab');

export const panel = (page: Page): Locator => page.locator('.explorer-panel');
/** The rows under the roots: the folders and the files, each root's row left out. */
export const rows = (page: Page): Locator => panel(page).locator('.list-row:not(.explorer-root)');
/** Each root's row, heading its section. */
export const rootRows = (page: Page): Locator => panel(page).locator('.list-row.explorer-root');
export const note = (page: Page): Locator => panel(page).locator('.explorer-note');
export const questionButton = (page: Page): Locator => panel(page).locator('.diff-question');
export const menuRows = (page: Page): Locator => page.locator('.kebab-menu button.menu-row');
