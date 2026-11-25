import type { DiffFile, DiffQuestion } from '../../shared/diff/types';
import { tabOnShow } from './views';
import { store } from './app';

/**
 * The Editor's tabs, one set per session tab (`editorTabs` in the store), in groups, and what opening, keeping, closing, stepping and reordering do to a group and to the set.
 * The rules are pure, so every surface that opens a file goes through the same ones, and the tests hold them; the writes below apply them to the set of the tab on show.
 */

/** A file opened in the Editor, and what it is compared with: a file of a checkout, against a commit, or any other file, against the text it had when a session first changed it. */
export type FileRef = CheckoutFileRef | SessionFileRef;

/** A file of a checkout, compared with the commit a question names. */
export interface CheckoutFileRef {
  kind: 'checkout';
  /** The checkout's root, which `file.path` is from. */
  root: string;
  file: DiffFile;
  /** The question its diff answers and the commit the opener read it against. */
  diff: { question: DiffQuestion; against: string };
  /** The files its previous and next file step through, in the opener's order, this one among them, each with its own checkout, so a step can cross from one checkout into the next. */
  files: readonly StepFile[];
}

/** A file git has nothing to compare with, by its absolute path, compared with the text it had when session `session` first changed it. */
export interface SessionFileRef {
  kind: 'session';
  session: string;
  path: string;
}

/** A file a tab steps through: the checkout it is in, the question that checkout was read for and the commit it was read against, and the file. */
export interface StepFile {
  root: string;
  question: DiffQuestion;
  against: string;
  file: DiffFile;
}

/** Whether `step` is the file `ref` shows. */
export const isShown = (ref: CheckoutFileRef, step: StepFile): boolean => step.root === ref.root && step.file.path === ref.file.path;

/** A file at `path` that no list names, so there are no counts to show: one its checkout's question lists no change in, or one git has nothing to compare with. */
export const unlistedFile = (path: string): DiffFile => ({ path, from: null, status: 'M', added: 0, deleted: 0, binary: false, generated: false });

/** The absolute path of the file `ref` shows. */
export const pathOf = (ref: FileRef): string => (ref.kind === 'checkout' ? `${ref.root}/${ref.file.path}` : ref.path);

export interface EditorTab {
  key: string;
  ref: FileRef;
  /** It takes the place of nothing, and the next file opened without keeping takes its place. */
  preview: boolean;
}

/** A group of tabs in the Editor: its files, in their order, and the one on show. */
export interface EditorGroup {
  tabs: readonly EditorTab[];
  active: string | null;
}

export const NO_GROUP: EditorGroup = { tabs: [], active: null };

/** One session tab's files in the Editor, in one group or two side by side, none of them empty; a file has one tab in the whole set. */
export interface EditorTabs {
  groups: readonly EditorGroup[];
  /** The group last pressed or given the keys: a file opens in it, and its tab on show is the Editor's file on show. */
  focused: number;
  /** The first group's part of the width while there are two, from 0 to 1. */
  share: number;
}

/** The share two groups start with. */
export const EVEN_SHARE = 0.5;

export const NO_TABS: EditorTabs = { groups: [], focused: 0, share: EVEN_SHARE };

/** A file's tab is one per file, whatever it is compared with. */
export const keyOf = (ref: FileRef): string => `file:${pathOf(ref)}`;

/**
 * Open `ref` and put it on show: the tab it already has, kept now when `keep` says so; else a new tab, a preview taking the place of the preview there is unless `keep`.
 * An open tab takes the newer ref, so it is compared as its opener now asks.
 */
export function opened(group: EditorGroup, ref: FileRef, keep: boolean): EditorGroup {
  const key = keyOf(ref);
  if (group.tabs.some((tab) => tab.key === key)) {
    return { tabs: group.tabs.map((tab) => (tab.key === key ? { key, ref, preview: tab.preview && !keep } : tab)), active: key };
  }
  const tab: EditorTab = { key, ref, preview: !keep };
  const preview = group.tabs.findIndex((each) => each.preview);
  if (keep || preview < 0) return { tabs: [...group.tabs, tab], active: key };
  return { tabs: group.tabs.map((each, index) => (index === preview ? tab : each)), active: key };
}

/** Keep a preview, so the next file opened takes a tab of its own. */
export function kept(group: EditorGroup, key: string): EditorGroup {
  return { ...group, tabs: group.tabs.map((tab) => (tab.key === key ? { ...tab, preview: false } : tab)) };
}

/** Put a tab on show. */
export function picked(group: EditorGroup, key: string): EditorGroup {
  return group.tabs.some((tab) => tab.key === key) ? { ...group, active: key } : group;
}

/** Close a tab; the one on show going, the tab after it takes its place, else the one before. */
export function closed(group: EditorGroup, key: string): EditorGroup {
  const at = group.tabs.findIndex((tab) => tab.key === key);
  if (at < 0) return group;
  const tabs = group.tabs.filter((tab) => tab.key !== key);
  if (group.active !== key) return { tabs, active: group.active };
  return { tabs, active: (tabs[at] ?? tabs[at - 1])?.key ?? null };
}

/**
 * Step the tab `key` to another file of its sequence, in its place, keeping whether it is a preview.
 * A file that already has a tab of its own is put on show instead, and the stepped tab goes, so no file has two.
 */
export function stepped(group: EditorGroup, key: string, ref: FileRef): EditorGroup {
  const next = keyOf(ref);
  if (next === key) return group;
  if (group.tabs.some((tab) => tab.key === next)) return { tabs: group.tabs.filter((tab) => tab.key !== key), active: next };
  return { tabs: group.tabs.map((tab) => (tab.key === key ? { key: next, ref, preview: tab.preview } : tab)), active: group.active === key ? next : group.active };
}

/** Close every tab but `key`, which is put on show. */
export function closedOthers(group: EditorGroup, key: string): EditorGroup {
  const kept = group.tabs.filter((tab) => tab.key === key);
  return kept.length === 0 ? group : { tabs: kept, active: key };
}

/** The tab `key` compared as `ref` says now, as when its file was read again against a newer commit, staying where it is and as it is. */
export function updated(group: EditorGroup, key: string, ref: FileRef): EditorGroup {
  return { ...group, tabs: group.tabs.map((tab) => (tab.key === key ? { ...tab, ref } : tab)) };
}

/** The tabs in the order a drag left them; a key the group does not have is passed over, and a tab the order leaves out keeps its place at the end. */
export function reordered(group: EditorGroup, keys: readonly string[]): EditorGroup {
  const byKey = new Map(group.tabs.map((tab) => [tab.key, tab]));
  const first = keys.flatMap((key) => byKey.get(key) ?? []);
  return { ...group, tabs: [...first, ...group.tabs.filter((tab) => !keys.includes(tab.key))] };
}

/**
 * The set with `groups` as its groups, `focused` the index among them of the group last pressed.
 * A group left with no tab goes, so the set of no files has no group, and the group last pressed going, the one left is; with one group left the split ends, so the next one starts even.
 */
function withGroups(set: EditorTabs, groups: readonly EditorGroup[], focused = set.focused): EditorTabs {
  const kept = groups.filter((group) => group.tabs.length > 0);
  const at = kept.indexOf(groups[focused] ?? NO_GROUP);
  return { groups: kept, focused: Math.max(at, 0), share: kept.length > 1 ? set.share : EVEN_SHARE };
}

/** The index of the group holding the tab `key`, or -1. */
export const groupOf = (set: EditorTabs, key: string): number => set.groups.findIndex((group) => group.tabs.some((tab) => tab.key === key));

/** Change the group holding the tab `key` by one of the rules above; a key no group holds changes nothing. */
export function inGroupOf(set: EditorTabs, key: string, change: (group: EditorGroup) => EditorGroup): EditorTabs {
  const at = groupOf(set, key);
  return at < 0 ? set : withGroups(set, set.groups.map((group, index) => (index === at ? change(group) : group)));
}

/** Open `ref` as `opened` does, in the group that has a tab for it already, else in the group last pressed, which a set of no files gets; either way that group becomes the one last pressed. */
export function openedIn(set: EditorTabs, ref: FileRef, keep: boolean): EditorTabs {
  const holder = groupOf(set, keyOf(ref));
  const groups = set.groups.length > 0 ? set.groups : [NO_GROUP];
  const at = holder >= 0 ? holder : Math.min(set.focused, groups.length - 1);
  return withGroups(
    set,
    groups.map((group, index) => (index === at ? opened(group, ref, keep) : group)),
    at,
  );
}

/**
 * Step the tab `key` as `stepped` does, in its group.
 * A file with a tab in the other group is put on show there, that group becomes the one last pressed, and the stepped tab goes, so no file has two.
 */
export function steppedIn(set: EditorTabs, key: string, ref: FileRef): EditorTabs {
  const next = keyOf(ref);
  const from = groupOf(set, key);
  const holder = groupOf(set, next);
  if (from < 0) return set;
  if (holder < 0 || holder === from) return inGroupOf(set, key, (group) => stepped(group, key, ref));
  return withGroups(
    set,
    set.groups.map((group, index) => (index === from ? closed(group, key) : index === holder ? picked(group, next) : group)),
    holder,
  );
}

/**
 * Move the tab `key` into the other group, at `at` among its tabs, or after them for none or a place below 0, kept and on show there, and make that group the one last pressed.
 * With one group the other is a new one after it, which splits the Editor; the group it leaves going empty, it goes, which ends the split.
 */
export function movedAcross(set: EditorTabs, key: string, at?: number): EditorTabs {
  const from = groupOf(set, key);
  const tab = set.groups[from]?.tabs.find((each) => each.key === key);
  if (!tab) return set;
  const to = from === 0 ? 1 : 0;
  const target = set.groups[to] ?? NO_GROUP;
  const tabs = [...target.tabs];
  tabs.splice(at !== undefined && at >= 0 ? at : tabs.length, 0, { ...tab, preview: false });
  const groups = [0, 1].map((index) => (index === from ? closed(set.groups[from]!, key) : index === to ? { tabs, active: key } : (set.groups[index] ?? NO_GROUP)));
  return withGroups(set, groups, to);
}

/** Make the group at `index` the one last pressed. */
export function focusedOn(set: EditorTabs, index: number): EditorTabs {
  return index === set.focused || index >= set.groups.length ? set : { ...set, focused: index };
}

/** The first group's part of the width set to `share`, while there are two. */
export function sharedAs(set: EditorTabs, share: number): EditorTabs {
  return set.groups.length < 2 || share === set.share ? set : { ...set, share };
}

/** The tab on show: the one on show in the group last pressed. */
export function shownTab(set: EditorTabs): EditorTab | undefined {
  const group = set.groups[set.focused];
  return group?.tabs.find((tab) => tab.key === group.active);
}

/** Every tab of the set, group after group. */
export const allTabs = (set: EditorTabs): readonly EditorTab[] => set.groups.flatMap((group) => group.tabs);

/** Whose set of the Editor's tabs is on show: the session of the tab on show, or '' while no tab is. */
export function editorSetKey(view = store.get()): string {
  return tabOnShow(view)?.session.id ?? '';
}

/** The Editor's tabs for the tab on show. */
export function editorTabsOnShow(view = store.get()): EditorTabs {
  return view.editorTabs.get(editorSetKey(view)) ?? NO_TABS;
}

/** Change the set of the tab on show by one of the rules above; a rule that returns the set itself tells no one. */
export function changeEditorTabs(change: (set: EditorTabs) => EditorTabs): void {
  const view = store.get();
  const key = editorSetKey(view);
  const before = view.editorTabs.get(key) ?? NO_TABS;
  const next = change(before);
  if (next === before) return;
  const all = new Map(view.editorTabs);
  const none = next.groups.length === 0;
  if (none) all.delete(key);
  else all.set(key, next);
  // The last file closed takes the drawer with it, as nothing is left to show in it.
  store.set(none ? { editorTabs: all, editorDrawer: false } : { editorTabs: all });
}

/** Change the group holding the tab `key`, in the set of the tab on show, by one of the rules above. */
export function changeEditorGroup(key: string, change: (group: EditorGroup) => EditorGroup): void {
  changeEditorTabs((set) => inGroupOf(set, key, change));
}

/** Whether the Editor is docked now: docked by choice, with a panel in the layout to dock in. */
export function editorDocked(view = store.get()): boolean {
  return view.editorUi.docked && view.editorDock;
}

/** Open a file in the Editor for the tab on show, a preview unless `keep`, and put the Editor in sight: in the drawer while it is not docked; with `line`, that line of it in sight too. */
export function openInEditor(ref: FileRef, keep: boolean, line: number | null = null): void {
  changeEditorTabs((set) => openedIn(set, ref, keep));
  store.set({ ...(editorDocked() ? {} : { editorDrawer: true }), editorAsked: { key: keyOf(ref), line } });
}
