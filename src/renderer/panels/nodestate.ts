import { keptOver } from '../../shared/kept';
import { NODE_STATE_FIELDS, nodeStateProblem, spelledSize, type NodeState, type PanelState } from '../../shared/panels';
import { DEFAULT_LAYOUT, pxOf, type ResolvedNode } from './layout';
import { roundShare } from './sizes';

/**
 * THE LAYOUT'S APP FILE AS THE WINDOW READS IT: this machine's sizes, folds and picks, by node id, each over the field of that name in your layout file (docs/architecture.md § Panel state).
 * Pure: the tree reads and writes it, this decides.
 */

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the app's file holds, and what is wrong with it: under the node a note is about, or for the file as a whole. */
export interface ReadNodeState {
  state: Record<string, NodeState>;
  notes: Record<string, string[]>;
  fileNotes: string[];
}

/**
 * The app's file read as the layout file is: every mistake named, and what is wrong left out rather than guessed at, since a person may have edited it.
 * An id the layout no longer has is no mistake: the tree leaves it out, and the next write drops it.
 */
export function readNodeState(json: unknown, file: string): ReadNodeState {
  const read: ReadNodeState = { state: {}, notes: {}, fileNotes: [] };
  if (json === null || json === undefined) return read;
  if (!isObject(json)) {
    read.fileNotes.push(`${file} has to hold one object, { "nodes": { … } }, so none of it is used.`);
    return read;
  }
  for (const key of Object.keys(json)) if (key !== 'nodes') read.fileNotes.push(`${file}: "${key}" is not something the app keeps.`);
  if (json.nodes === undefined) return read;
  if (!isObject(json.nodes)) {
    read.fileNotes.push(`${file}: nodes is not an object, so none of it is used.`);
    return read;
  }
  for (const [id, raw] of Object.entries(json.nodes)) {
    const notes: string[] = [];
    if (!isObject(raw)) notes.push(`${file}: what it keeps for ${id} is not an object.`);
    else {
      const state: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(raw)) {
        if (!(NODE_STATE_FIELDS as string[]).includes(field)) notes.push(`${file}: ${field} is not something the app keeps for a node.`);
        else {
          const problem = nodeStateProblem(field as keyof NodeState, value);
          if (problem) notes.push(`${file}: ${problem}`);
          else state[field] = value;
        }
      }
      if (Object.keys(state).length > 0) read.state[id] = state;
    }
    if (notes.length > 0) read.notes[id] = notes;
  }
  return read;
}

/** Every id in the tree, nodes and slots alike: what an id the app keeps something for has to be one of. */
export function idsIn(node: ResolvedNode, into = new Set<string>()): Set<string> {
  into.add(node.id);
  if (node.kind === 'split') for (const child of node.children) idsIn(child, into);
  else for (const slot of node.slots) into.add(slot.key);
  return into;
}

/**
 * The tree's state as `meta.json` kept it before the config folder, as what the app's file keeps: worked out once, against the tree, since only the tree knows which node is which.
 * A split's dragged px count only while they name every one of its children, as they did: a pixel child's become its pixels, and the flexible children's become shares of what they shared, which shows the same; a lone flexible child takes what is left and is not written.
 * The sidebar's width from before it was a node goes the same way, into the default layout's root, as it was adopted there.
 * A fold or a pick counts where the group is in the tree, and only where it differs from what your file already says.
 */
export function stateFromPanelState(root: ResolvedNode, legacy: PanelState, legacySidebarWidth: number | null, windowWidth: number): Record<string, NodeState> {
  const sizes = { ...legacy.sizes };
  const defaultRoot = DEFAULT_LAYOUT.root;
  if (!sizes[defaultRoot.id] && 'columns' in defaultRoot) {
    const sidebar = defaultRoot.columns[0]!;
    const main = defaultRoot.columns[1]!;
    const width = legacySidebarWidth ?? 0;
    // A width the sidebar could not have been dragged to is damage, not a preference.
    if (width >= (sidebar.min ?? 0) && width < windowWidth) sizes[defaultRoot.id] = { [sidebar.id]: width, [main.id]: windowWidth - width };
  }
  const state: Record<string, NodeState> = {};
  const set = (id: string, field: keyof NodeState, value: NodeState[keyof NodeState]): void => {
    state[id] = { ...state[id], [field]: value };
  };
  const walk = (node: ResolvedNode): void => {
    if (node.kind === 'group') {
      if (node.collapsible && node.problems.length === 0 && legacy.collapsed.includes(node.id) && !node.folded) set(node.id, 'folded', true);
      const picked = legacy.active[node.id];
      if (picked !== undefined && picked !== node.active && node.slots.some((slot) => slot.key === picked && !slot.hidden)) set(node.id, 'active', picked);
      return;
    }
    node.children.forEach(walk);
    const stored = sizes[node.id];
    const ids = node.children.map((child) => child.id);
    if (!stored || Object.keys(stored).length !== ids.length || ids.some((id) => stored[id] === undefined)) return;
    const flexible = node.children.filter((child) => pxOf(child) === null);
    const room = flexible.reduce((sum, child) => sum + stored[child.id]!, 0);
    for (const child of node.children) {
      const size = pxOf(child) !== null ? spelledSize({ px: Math.round(stored[child.id]!) }) : flexible.length > 1 && room > 0 ? roundShare(stored[child.id]! / room) : null;
      // What the file already says is not written, as for a fold or a pick: a split's px name every child, the ones never dragged too.
      const kept = size === null ? null : keptOver(size, child.size ? spelledSize(child.size) : null);
      if (kept !== null) set(child.id, 'size', kept);
    }
  };
  walk(root);
  return state;
}
