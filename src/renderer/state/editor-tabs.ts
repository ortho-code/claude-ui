import type { DiffFile, DiffQuestion } from '../../shared/diff/types';
import { tabOnShow } from './views';
import { store } from './app';

/**
 * The Editor's tabs, one set per session tab (`editorTabs` in the store), and what opening, keeping, closing, stepping and reordering do to a set.
 * The rules are pure, so every surface that opens a file goes through the same ones, and the tests hold them; the writes below apply them to the set of the tab on show.
 */

/** A file opened in the Editor, and what it is compared with. */
export interface FileRef {
  /** The checkout's root, which `file.path` is from. */
  root: string;
  file: DiffFile;
  /** The question its diff answers and the commit the opener read it against. */
  diff: { question: DiffQuestion; against: string };
  /** The files its previous and next file step through, in the opener's order, this one among them. */
  files: readonly DiffFile[];
}

export interface EditorTab {
  key: string;
  ref: FileRef;
  /** It takes the place of nothing, and the next file opened without keeping takes its place. */
  preview: boolean;
}

/** One session tab's files in the Editor, in their order, and the one on show. */
export interface EditorTabs {
  tabs: readonly EditorTab[];
  active: string | null;
}

export const NO_TABS: EditorTabs = { tabs: [], active: null };

/** A file's tab is one per file, whatever it is compared with. */
export const keyOf = (ref: FileRef): string => `file:${ref.root}/${ref.file.path}`;

/**
 * Open `ref` and put it on show: the tab it already has, kept now when `keep` says so; else a new tab, a preview taking the place of the preview there is unless `keep`.
 * An open tab takes the newer ref, so it is compared as its opener now asks.
 */
export function opened(set: EditorTabs, ref: FileRef, keep: boolean): EditorTabs {
  const key = keyOf(ref);
  if (set.tabs.some((tab) => tab.key === key)) {
    return { tabs: set.tabs.map((tab) => (tab.key === key ? { key, ref, preview: tab.preview && !keep } : tab)), active: key };
  }
  const tab: EditorTab = { key, ref, preview: !keep };
  const preview = set.tabs.findIndex((each) => each.preview);
  if (keep || preview < 0) return { tabs: [...set.tabs, tab], active: key };
  return { tabs: set.tabs.map((each, index) => (index === preview ? tab : each)), active: key };
}

/** Keep a preview, so the next file opened takes a tab of its own. */
export function kept(set: EditorTabs, key: string): EditorTabs {
  return { ...set, tabs: set.tabs.map((tab) => (tab.key === key ? { ...tab, preview: false } : tab)) };
}

/** Put a tab on show. */
export function picked(set: EditorTabs, key: string): EditorTabs {
  return set.tabs.some((tab) => tab.key === key) ? { ...set, active: key } : set;
}

/** Close a tab; the one on show going, the tab after it takes its place, else the one before. */
export function closed(set: EditorTabs, key: string): EditorTabs {
  const at = set.tabs.findIndex((tab) => tab.key === key);
  if (at < 0) return set;
  const tabs = set.tabs.filter((tab) => tab.key !== key);
  if (set.active !== key) return { tabs, active: set.active };
  return { tabs, active: (tabs[at] ?? tabs[at - 1])?.key ?? null };
}

/**
 * Step the tab `key` to another file of its sequence, in its place, keeping whether it is a preview.
 * A file that already has a tab of its own is put on show instead, and the stepped tab goes, so no file has two.
 */
export function stepped(set: EditorTabs, key: string, ref: FileRef): EditorTabs {
  const next = keyOf(ref);
  if (next === key) return set;
  if (set.tabs.some((tab) => tab.key === next)) return { tabs: set.tabs.filter((tab) => tab.key !== key), active: next };
  return { tabs: set.tabs.map((tab) => (tab.key === key ? { key: next, ref, preview: tab.preview } : tab)), active: set.active === key ? next : set.active };
}

/** The tab `key` compared as `ref` says now, as when its file was read again against a newer commit, staying where it is and as it is. */
export function updated(set: EditorTabs, key: string, ref: FileRef): EditorTabs {
  return { ...set, tabs: set.tabs.map((tab) => (tab.key === key ? { ...tab, ref } : tab)) };
}

/** The tabs in the order a drag left them; a key the set does not have is passed over, and a tab the order leaves out keeps its place at the end. */
export function reordered(set: EditorTabs, keys: readonly string[]): EditorTabs {
  const byKey = new Map(set.tabs.map((tab) => [tab.key, tab]));
  const first = keys.flatMap((key) => byKey.get(key) ?? []);
  return { ...set, tabs: [...first, ...set.tabs.filter((tab) => !keys.includes(tab.key))] };
}

/** Whose set of the Editor's tabs is on show: the session of the tab on show, or '' while no tab is. */
export function editorSetKey(view = store.get()): string {
  return tabOnShow(view)?.session.id ?? '';
}

/** The Editor's tabs for the tab on show. */
export function editorTabsOnShow(view = store.get()): EditorTabs {
  return view.editorTabs.get(editorSetKey(view)) ?? NO_TABS;
}

/** Change the set of the tab on show by one of the rules above. */
export function changeEditorTabs(change: (set: EditorTabs) => EditorTabs): void {
  const view = store.get();
  const key = editorSetKey(view);
  const next = change(view.editorTabs.get(key) ?? NO_TABS);
  const all = new Map(view.editorTabs);
  if (next.tabs.length === 0) all.delete(key);
  else all.set(key, next);
  store.set({ editorTabs: all });
}

/** Open a file in the Editor for the tab on show: a preview unless `keep`; nothing while no Editor is on (`editorOn`), which the opener says itself. */
export function openInEditor(ref: FileRef, keep: boolean): void {
  if (!store.get().editorOn) return;
  changeEditorTabs((set) => opened(set, ref, keep));
}
