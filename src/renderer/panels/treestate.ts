import { NODE_STATE_FIELDS, parseSize, withNodeChanges, type LayoutReport, type NodeSize, type NodeState, type NodeStateChange, type PanelState } from '../../shared/panels';
import { fileName, type ResolvedGroup, type ResolvedNode, type ResolvedSplit } from './layout';
import { idsIn, readNodeState, stateFromPanelState } from './nodestate';
import { withOverrides } from './sizes';
import type { TreeHost } from './tree';

/** The tree on screen, and where the window's toasts go; set once by `initTreeState`. */
let treeOf: () => ResolvedNode;
let toasts: Pick<TreeHost, 'showToast' | 'hideToast'>;
/**
 * This machine's sizes, folds and picks, by node id, as the app's file beside the layout keeps them (nodestate.ts), each over the field of that name in the layout file.
 * What the window changes it changes here at once and has main keep there (`keep`); a read of that file replaces it only when somebody other than the app wrote it.
 */
let nodeState: Record<string, NodeState> = {};
/** What is wrong with that file: under the node a note is about, and for the file as a whole under the window. */
let stateNotes: Record<string, string[]> = {};
let stateFileNotes: string[] = [];
/** Whether a read of that file has been taken in, which is when an id it holds can be judged against the layout. */
let stateRead = false;
/** The tree's state from before, as `meta.json` kept it, until the first read moves it into that file. */
let legacy: { state: PanelState; sidebarWidth: number | null } | null = null;
/** The splits whose sizes from that file are set aside, so the log says so once per change rather than at every draw. */
let setAside = new Set<string>();
/** The toast that file put up while it does not parse, so a good read takes down that one and never another. */
let stateToasted: string | null = null;

/** The tree whose nodes the state is kept for, and the toasts that say what is wrong with its file. */
export function initTreeState(tree: () => ResolvedNode, toast: Pick<TreeHost, 'showToast' | 'hideToast'>): void {
  treeOf = tree;
  toasts = toast;
}

/** The window's sizes, fold and pick of node `id`, over the layout file's. */
export function stateOf(id: string): NodeState | undefined {
  return nodeState[id];
}

/** What is wrong with what the app's file keeps for node `id`. */
export function stateNotesOf(id: string): string[] {
  return stateNotes[id] ?? [];
}

/** What is wrong with the app's file as a whole. */
export function stateFileNotesNow(): string[] {
  return stateFileNotes;
}

/**
 * The tree's state as `meta.json` kept it before the config folder, held until the first read of the layout moves it into the app's file beside it, once (`takeState`).
 * `legacySidebarWidth` is the sidebar's width from before the sidebar was a node in the tree, which goes the same way (`stateFromPanelState`).
 */
export function holdLegacyState(state: PanelState, legacySidebarWidth: number | null): void {
  legacy = { state, sidebarWidth: legacySidebarWidth };
}

/**
 * Take in a read of the app's file beside the layout: a toast while it does not parse, and its state in place of the window's unless the app itself wrote what it holds, since the window's own is then as new or newer.
 * The first read also moves the state `meta.json` kept, if it has not moved yet, worked out against `root` since only the tree knows which node is which; main makes the move once and not over a file that already holds something.
 */
export function takeState(local: LayoutReport['local'], root: ResolvedNode): void {
  const message = local.status === 'unparsable' ? `${fileName(local.file)}: ${local.error ?? 'it could not be read'}` : null;
  if (message !== stateToasted) {
    if (stateToasted !== null) toasts.hideToast(stateToasted);
    if (message !== null) toasts.showToast(message, true);
    stateToasted = message;
  }
  // The window's state stands while the file does not parse; the app will not write over it either (appfiles.ts).
  if (local.status === 'unparsable') return;
  if (local.byApp && stateRead) return;
  const read = readNodeState(local.json, fileName(local.file));
  nodeState = read.state;
  stateNotes = read.notes;
  stateFileNotes = read.fileNotes;
  stateRead = true;
  if (local.stateMoved) {
    legacy = null;
    return;
  }
  const moved = legacy ? stateFromPanelState(root, legacy.state, legacy.sidebarWidth, window.innerWidth) : {};
  legacy = null;
  if (Object.keys(nodeState).length === 0) nodeState = moved;
  void window.claudeUi.moveLayoutState(moved).then(({ refused }) => {
    if (refused !== null) toasts.showToast(refused);
  });
}

/**
 * Keep what the window changed: in its own state at once, and in the app's file beside the layout through main.
 * An id the layout no longer has is dropped on the way, since what was kept for it is only a size, a fold or a pick (decision 4.3); judged only once the file has been read, never against the default layout drawn before it.
 */
export function keep(changes: NodeStateChange[]): void {
  const ids = idsIn(treeOf());
  const stale = stateRead ? Object.entries(nodeState).flatMap(([id, state]) => (ids.has(id) ? [] : NODE_STATE_FIELDS.filter((field) => state[field] !== undefined).map((field) => ({ id, field, value: null })))) : [];
  const all = [...stale, ...changes];
  nodeState = withNodeChanges(nodeState, all);
  void window.claudeUi.setLayoutState(all).then(({ refused }) => {
    if (refused !== null) toasts.showToast(refused);
  });
}

/** A group's fold as it stands: the window's, else the file's. */
export const foldedNow = (group: ResolvedGroup): boolean => nodeState[group.id]?.folded ?? group.folded;

/**
 * A split's children's sizes as they stand, the app's over the file's, unless the guard sets the app's aside (`withOverrides`), which the log says once per change.
 * `dragging` holds the sizes of a drag under way, over both.
 */
export function sizesOf(split: ResolvedSplit, visible: ResolvedNode[], dragging: Record<string, NodeSize> = {}): (NodeSize | null)[] {
  const overrides = Object.fromEntries(split.children.map((child) => [child.id, dragging[child.id] ?? parseSize(nodeState[child.id]?.size) ?? undefined]));
  const { sizes, dropped } = withOverrides(split.children, overrides);
  if (dropped !== setAside.has(split.id)) {
    setAside = new Set(setAside);
    if (dropped) {
      setAside.add(split.id);
      window.claudeUi.log('info', 'layout', `the sizes dragged to in ${split.id} would leave a child without a size no room, so the file's sizes are shown`);
    } else setAside.delete(split.id);
  }
  return visible.map((child) => sizes[split.children.indexOf(child)]!);
}
