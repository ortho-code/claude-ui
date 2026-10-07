import { keptOver } from '../../shared/kept';
import { NODE_STATE_FIELDS, parseSize, spelledSize, withNodeChanges, type LayoutReport, type NodeSize, type NodeState, type NodeStateChange, type PanelState } from '../../shared/panels';
import { idsIn, readNodeState, stateFromPanelState } from './nodestate';
import { element } from '../dom';
import { installSplitResizer } from '../resizer';
import { badgeClass } from '../statusdot';
// A panel header's count wears the section heading's count pill.
import '../card.css';
import './tree.css';
import { chevronIcon, strokeIcon, type Direction } from '../svg';
import { setTooltip } from '../tooltip';
import { iconSvg } from './icons';
import { optionsOf } from './options';
import {
  fileName,
  foldEdge,
  isEmpty,
  mountSignature,
  resolveLayout,
  type PanelSlot,
  type ResolvedGroup,
  type ResolvedNode,
  type ResolvedSplit,
} from './layout';
import { dragTargets, flexFor, sizesAfterDrag, withOverrides, type FlexChild } from './sizes';
import { claudeType } from './types/claude';
import { sessionsType } from './types/sessions';
import { folderTypes } from './types/folder';
import { linkedSessions, pickSession, startSession } from './links';
import type { Asks, MountedPanel, PanelHost, PanelStatus, PanelType, Where } from './contract';
import { commandType } from './types/command';
import { terminalType } from './types/terminal';

/**
 * The window, drawn from the layout tree: nested rows and columns of groups, each group showing one panel, with the app's own sidebar and terminal area as two of the panels.
 *
 * Built from main's report of the layout file and rebuilt whenever that file changes, a group folds, or another panel is picked.
 * A rebuild recreates the splits, dividers, rails and headers, but NEVER a panel: mounted panels are kept by entry key and moved into their new place, so a save that adds a panel restarts nothing else (decision 13).
 * The built-ins are the elements the app has always had, moved in the same way.
 * Before the first read the tree is the default layout, drawn synchronously at start-up, so the first paint is already the window as it will be without a file.
 * Panels are mounted hidden and not shown until `startPanels`, which the renderer calls once the tabs are restored, so a panel's first run is in the restored tab's folder.
 *
 * Two choices tried in the playground and open to change sit in one function each, so swapping to another variant is a local change: `foldControls` (the chevron on the divider, P7/P12) and `switcher` (the rail of icons, P9).
 */

const BUILTIN_TYPES: Record<string, PanelType> = { sessions: sessionsType, claude: claudeType, command: commandType, terminal: terminalType };

/** Every type the layout can place: the built-ins, and the config folder's as of its last read (types/folder.ts). */
let types = BUILTIN_TYPES;

/**
 * What the tree needs from the renderer: where a panel would run, the toast, and the answers to every ask a panel can make (`Asks`), which each panel's host carries as they are.
 * Its own state it keeps itself, in the app's file beside the layout (`keep`).
 * A panel's session links are the tree's own (links.ts).
 */
export interface TreeHost {
  where(): Where;
  showToast(message: string, sticky?: boolean): void;
  /** Take down the toast `message`, if it is still the one up. */
  hideToast(message: string): void;
  /** One route for every panel, the built-ins included: a panel's ask IS the answer of the built-in that owns it. */
  asks: Asks;
}

/** A panel on screen, and the marks it reports through — made once with it, so a rebuilt header or rail shows the same marks rather than orphaning them. */
interface Mounted {
  panel: MountedPanel;
  /** Its type and declared parameters: a change to either mounts it afresh, a change to anything else (title, icon) does not. */
  signature: string;
  busy: HTMLElement;
  end: HTMLElement;
  action: HTMLButtonElement | null;
  /** The dot on its rail icon (P8). */
  badge: HTMLElement;
  /** The count it reports, twice, since one element cannot stand in two places: beside the header's title, and on its rail icon. */
  count: HTMLElement;
  railCount: HTMLElement;
  /** The count as last reported, for the rail's label, which says it whole where the badge cannot. */
  countValue: number | null;
  /** Why the panel says it cannot run, as it last reported: drawn in its place, with `alert` on its rail icon. */
  problems: string[];
  /** What the panel says about itself that does not stop it, for its group's note line. */
  notes: string[];
}

/**
 * Where a child sits in its split: along which axis, which edge it folds toward, whether it is folded, and how to fold or unfold it — null for a child that cannot.
 * The root has no axis and cannot fold.
 */
interface Place {
  axis: 'rows' | 'columns' | null;
  edge: 'start' | 'end';
  folded: boolean;
  toggleFold: (() => void) | null;
}

const REFRESH_ICON = strokeIcon(14, '<path d="M12.8 8.6A4.8 4.8 0 1 1 11.6 4.5" /><path d="M12.9 2.8v2.6h-2.6" />');

let host: TreeHost;
let app: HTMLElement;
/** The tree on screen: the last good read, or the default layout until there is one. */
let tree: ResolvedNode;
const mounted = new Map<string, Mounted>();
/** The keys of the panels the last render put on show, as opposed to mounted behind another or folded away. */
let onShow = new Set<string>();
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
/** Whether panels may be shown, which is when they first run. */
let live = false;
/** The toast the tree last put up, so a good read takes down that one and never anybody else's. */
let toasted: string | null = null;
/** A render asked for by a panel reporting something new, run once the current task is done so a report made during a render never renders inside it. */
let renderQueued = false;

function queueRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    render();
  });
}

/** Draw the default layout now, before the first paint, and follow the layout file from here on. */
export function initTree(treeHost: TreeHost): void {
  host = treeHost;
  app = document.getElementById('app')!;
  const view = resolveLayout(
    { configRoot: '', file: '', status: 'missing', error: null, json: null, types: [], local: { file: '', status: 'missing', error: null, json: null, byApp: false, stateMoved: true } },
    types,
  );
  if (view.kind === 'tree') tree = view.root;
  render();
  window.claudeUi.onLayoutChanged((next) => apply(next));
}

/** The first read of the layout file. */
export async function loadLayout(): Promise<void> {
  apply(await window.claudeUi.getLayout());
}

/** From here on panels are shown, and so run: called once the tabs are restored. */
export function startPanels(): void {
  live = true;
  showPanels();
}

/**
 * The tab or project changed: let every panel decide whether that moved its context.
 * A hidden one only notes it (RunGate).
 */
export function treeContextChanged(): void {
  for (const { panel } of mounted.values()) panel.contextChanged();
}

let sessionsQueued = false;

/**
 * A session's status, a tab, the session list, or a panel's own data changed: every panel that draws sessions repaints them.
 * Called from wherever the renderer repaints those itself, often several times in one task, so the panels hear it once, after the task.
 */
export function treeSessionsChanged(): void {
  if (sessionsQueued) return;
  sessionsQueued = true;
  queueMicrotask(() => {
    sessionsQueued = false;
    for (const { panel } of mounted.values()) panel.sessionsChanged?.();
  });
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
function takeState(local: LayoutReport['local'], root: ResolvedNode): void {
  const message = local.status === 'unparsable' ? `${fileName(local.file)}: ${local.error ?? 'it could not be read'}` : null;
  if (message !== stateToasted) {
    if (stateToasted !== null) host.hideToast(stateToasted);
    if (message !== null) host.showToast(message, true);
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
    if (refused !== null) host.showToast(refused);
  });
}

/**
 * Keep what the window changed: in its own state at once, and in the app's file beside the layout through main.
 * An id the layout no longer has is dropped on the way, since what was kept for it is only a size, a fold or a pick (decision 4.3); judged only once the file has been read, never against the default layout drawn before it.
 */
function keep(changes: NodeStateChange[]): void {
  const ids = idsIn(tree);
  const stale = stateRead ? Object.entries(nodeState).flatMap(([id, state]) => (ids.has(id) ? [] : NODE_STATE_FIELDS.filter((field) => state[field] !== undefined).map((field) => ({ id, field, value: null })))) : [];
  const all = [...stale, ...changes];
  nodeState = withNodeChanges(nodeState, all);
  void window.claudeUi.setLayoutState(all).then(({ refused }) => {
    if (refused !== null) host.showToast(refused);
  });
}

/** A group's fold as it stands: the window's, else the file's. */
const foldedNow = (group: ResolvedGroup): boolean => nodeState[group.id]?.folded ?? group.folded;

/**
 * A split's children's sizes as they stand, the app's over the file's, unless the guard sets the app's aside (`withOverrides`), which the log says once per change.
 * `dragging` holds the sizes of a drag under way, over both.
 */
function sizesOf(split: ResolvedSplit, visible: ResolvedNode[], dragging: Record<string, NodeSize> = {}): (NodeSize | null)[] {
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

function apply(next: LayoutReport): void {
  const found = folderTypes(next.types, BUILTIN_TYPES);
  const view = resolveLayout(next, found.types, found.notes);
  // A file that does not parse keeps the last good layout up: the message names the file and the parser's position, and stays until a read succeeds, because the condition does not clear on its own.
  if (view.kind === 'unparsable') {
    toasted = `${fileName(view.file)}: ${view.message}`;
    host.showToast(toasted, true);
    return;
  }
  if (toasted !== null) {
    host.hideToast(toasted);
    toasted = null;
  }
  // Taken with the tree it was resolved against, never apart from it, so a layout kept up over a bad read keeps the types it was drawn with.
  types = found.types;
  tree = view.root;
  takeState(next.local, tree);
  render();
  // Something in the config folder changed, which may be a file or folder a panel's options point at: every panel checks again, in its own terms.
  for (const { panel } of mounted.values()) panel.recheck();
}

function render(): void {
  // Unmount what the new tree no longer holds FIRST: a built-in that moved to another key is parked before it is placed again, never after.
  const wanted = new Map<string, string>();
  collectWanted(tree, wanted);
  for (const [key, entry] of mounted) {
    if (wanted.get(key) === entry.signature) continue;
    entry.panel.unmount();
    mounted.delete(key);
  }
  // Moving an element resets its scroll offsets and drops its focus, so both are carried across the rebuild.
  const focused = document.activeElement;
  const scrolled = scrollOffsets();
  onShow = new Set();
  const root = renderNode(tree, { axis: null, edge: 'start', folded: false, toggleFold: null });
  // What is wrong with the app's file as a whole, under the window, as a file-wide problem of the layout's is.
  if (stateFileNotes.length === 0) app.replaceChildren(root);
  else {
    const wrap = element('div', 'split-wrap');
    wrap.append(root, notesLine(stateFileNotes));
    app.replaceChildren(wrap);
  }
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  showPanels();
}

/** Every panel the tree holds: the entries that can run and are not hidden, by key, with what they are mounted as. */
function collectWanted(node: ResolvedNode, into: Map<string, string>): void {
  if (node.kind === 'split') {
    for (const child of node.children) collectWanted(child, into);
    return;
  }
  for (const slot of node.slots) if (!slot.hidden && slot.problems.length === 0) into.set(slot.key, signatureOf(slot));
}

/** What a slot is mounted as, its type's revision included, so an edited manifest mounts that type's panels afresh. */
function signatureOf(slot: PanelSlot): string {
  return mountSignature(slot, (slot.type && types[slot.type]?.revision) ?? null);
}

function scrollOffsets(): [HTMLElement, number, number][] {
  const found: [HTMLElement, number, number][] = [];
  for (const { panel } of mounted.values()) {
    for (const el of [panel.el, ...panel.el.querySelectorAll<HTMLElement>('*')]) {
      if (el.scrollTop !== 0 || el.scrollLeft !== 0) found.push([el, el.scrollTop, el.scrollLeft]);
    }
  }
  return found;
}

function showPanels(): void {
  if (!live) return;
  for (const [key, { panel }] of mounted) panel.setVisible(onShow.has(key));
}

function renderNode(node: ResolvedNode, place: Place): HTMLElement {
  return node.kind === 'split' ? renderSplit(node) : renderGroup(node, place);
}

/**
 * A group that can fold: it asks to, and is not degraded.
 * Whether it has a divider to fold from is the split's to say.
 */
const foldable = (node: ResolvedNode): node is ResolvedGroup => node.kind === 'group' && node.collapsible && node.problems.length === 0;

function renderSplit(split: ResolvedSplit): HTMLElement {
  const visible = split.children.filter((child) => !isEmpty(child));
  const edges = visible.map((_, index) => foldEdge(visible, index));
  const folded = visible.map((child) => foldable(child) && foldedNow(child));
  const box = element('div', `split ${split.axis}`);
  const nodes: HTMLElement[] = [];
  // One fold per child that has a divider to fold from, behind both its chevron and its rail, so the two cannot fold it differently.
  const toggles = visible.map((child, index) => (visible.length > 1 && foldable(child) ? () => toggleFold(split, visible, nodes, folded, index) : null));
  visible.forEach((child, index) => {
    if (index > 0) box.append(divider(split, visible, nodes, edges, folded, toggles, index - 1, index));
    const node = element('div', 'node');
    node.append(renderNode(child, { axis: split.axis, edge: edges[index]!, folded: folded[index]!, toggleFold: toggles[index] ?? null }));
    nodes.push(node);
    box.append(node);
  });
  applyFlex(split, visible, nodes, folded);
  const notes = [...split.notes, ...(stateNotes[split.id] ?? [])];
  if (notes.length === 0) return box;
  const wrap = element('div', 'split-wrap');
  wrap.append(box, notesLine(notes));
  return wrap;
}

function flexChildren(visible: ResolvedNode[], folded: boolean[], sizes: (NodeSize | null)[]): FlexChild[] {
  return visible.map((child, index) => ({ id: child.id, size: sizes[index]!, min: child.min, folded: folded[index]! }));
}

/** Size a split's children from the file and the app's sizes over it, a drag under way over both (panels/sizes.ts decides; this applies). */
function applyFlex(split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], folded: boolean[], dragging?: Record<string, NodeSize>): void {
  const horizontal = split.axis === 'columns';
  flexFor(flexChildren(visible, folded, sizesOf(split, visible, dragging))).forEach((value, index) => {
    const style = nodes[index]!.style;
    style.flex = value.flex;
    style.minWidth = horizontal && value.min !== null ? `${value.min}px` : '';
    style.minHeight = !horizontal && value.min !== null ? `${value.min}px` : '';
  });
}

function measure(nodes: HTMLElement[], horizontal: boolean): number[] {
  return nodes.map((node) => {
    const box = node.getBoundingClientRect();
    return horizontal ? box.width : box.height;
  });
}

/**
 * The divider between two neighbours.
 * Always there; draggable only when both are resizable and neither is folded, and one that is not says why on hover, so it does not read as broken (P11).
 * A drag keeps the sizes it ends on, each in its node's own unit (`sizesAfterDrag`), once the button comes up; a double-click on a divider of the split takes every size kept for its children away, which is the file's sizes back.
 */
function divider(split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], edges: Place['edge'][], folded: boolean[], toggles: Place['toggleFold'][], a: number, b: number): HTMLElement {
  const handle = element('div', 'divider');
  foldControls(handle, split, visible, nodes, edges, folded, toggles, a, b);
  const shut = [a, b].filter((index) => folded[index]).map((index) => visible[index]!.id);
  const fixed = [a, b].filter((index) => !visible[index]!.resizable).map((index) => visible[index]!.id);
  if (shut.length > 0) {
    setTooltip(handle, `Unfold ${shut.join(' and ')} to resize`);
    return handle;
  }
  if (fixed.length > 0) {
    setTooltip(handle, `Fixed size: ${fixed.join(' and ')} ${fixed.length === 1 ? 'has' : 'have'} "resizable": false`);
    return handle;
  }
  handle.classList.add('drag');
  setTooltip(handle, 'Drag to resize, double-click to reset');
  handle.addEventListener('dblclick', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) return;
    const kept = split.children.filter((child) => nodeState[child.id]?.size !== undefined);
    if (kept.length === 0) return;
    keep(kept.map((child) => ({ id: child.id, field: 'size', value: null })));
    render();
  });
  const horizontal = split.axis === 'columns';
  let measured: number[] = [];
  let start: FlexChild[] = [];
  let dragged: Record<string, NodeSize> | null = null;
  installSplitResizer(handle, {
    axis: horizontal ? 'x' : 'y',
    onStart: () => {
      measured = measure(nodes, horizontal);
      start = flexChildren(visible, folded, sizesOf(split, visible));
      dragged = null;
    },
    onMove: (delta) => {
      dragged = sizesAfterDrag(start, measured, dragTargets(start, measured, a, b, delta), a, b);
      applyFlex(split, visible, nodes, folded, dragged);
    },
    onEnd: () => {
      if (dragged) keep(Object.entries(dragged).map(([id, size]) => ({ id, field: 'size', value: spelledSize(size) })));
      dragged = null;
    },
  });
  return handle;
}

const OPPOSITE: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/**
 * THE FOLD CONTROL (P7, P12): a chevron on the divider on the other side of the edge a group folds toward, pointing the way it moves, and turned round while it is folded.
 * Two on one divider — two foldable groups alone in a split — sit one after the other along the line, each pointing into its own group, so neither covers a header; hovering one outlines the group it acts on.
 * Faint until the pointer is on the divider (tree.css), so a window of foldable groups is not a row of buttons.
 */
function foldControls(handle: HTMLElement, split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], edges: Place['edge'][], folded: boolean[], toggles: Place['toggleFold'][], a: number, b: number): void {
  const riders = [a, b].filter((index) => toggles[index] && edges[index] === (index === a ? 'start' : 'end'));
  const horizontal = split.axis === 'columns';
  for (const index of riders) {
    const group = visible[index]!;
    const toward: Direction = horizontal ? (edges[index] === 'start' ? 'left' : 'right') : edges[index] === 'start' ? 'up' : 'down';
    const chevron = element('button', `icon-btn chev ${index === a ? 'before' : 'after'}${riders.length === 2 ? ' shared' : ''}`);
    chevron.type = 'button';
    chevron.innerHTML = chevronIcon(folded[index] ? OPPOSITE[toward] : toward, 10);
    const label = `${folded[index] ? 'Unfold' : 'Fold'} ${group.id}`;
    chevron.setAttribute('aria-label', label);
    setTooltip(chevron, label);
    chevron.addEventListener('mouseenter', () => nodes[index]!.classList.add('fold-target'));
    chevron.addEventListener('mouseleave', () => nodes[index]!.classList.remove('fold-target'));
    chevron.addEventListener('click', toggles[index]!);
    handle.append(chevron);
  }
}

/**
 * Fold a group to its rail, or unfold it: the one fold, behind the chevron and the rail alike.
 * A child's size is its own, kept per node, so it unfolds to the size it had with nothing to take beforehand.
 */
function toggleFold(_split: ResolvedSplit, visible: ResolvedNode[], _nodes: HTMLElement[], folded: boolean[], index: number): void {
  const group = visible[index] as ResolvedGroup;
  keep([{ id: group.id, field: 'folded', value: keptOver(!folded[index], group.folded) }]);
  render();
}

/**
 * The slot a group shows: the one picked there, else the file's `active`, else the first.
 * Every slot is reachable from the rail, so nothing — the terminal included — can be stranded behind another.
 */
function shownSlot(group: ResolvedGroup, slots: PanelSlot[]): PanelSlot {
  return slots.find((slot) => slot.key === nodeState[group.id]?.active) ?? slots.find((slot) => slot.key === group.active) ?? slots[0]!;
}

function renderGroup(group: ResolvedGroup, place: Place): HTMLElement {
  const section = element('section', 'panel-group');
  if (group.problems.length > 0) {
    section.append(header(`⚠ ${group.title}`), problemList(group.problems));
    if (group.notes.length > 0) section.append(notesLine(group.notes));
    return section;
  }
  const slots = group.slots.filter((slot) => !slot.hidden);
  const shown = shownSlot(group, slots);
  const content = element('div', 'panel-content');
  for (const slot of slots) {
    if (slot.problems.length > 0) continue;
    const { panel, problems } = mountedFor(slot);
    // Every panel of the group is placed, the ones not on show hidden, so each keeps its DOM and its process; one that says it cannot run is drawn as its problems instead.
    panel.el.hidden = place.folded || slot !== shown || problems.length > 0;
    content.append(panel.el);
  }
  if (shown.problems.length > 0) {
    content.prepend(header(shown.title), problemList(shown.problems));
  } else if (!types[shown.type!]!.bare) {
    const { count, busy, end, action, problems } = mountedFor(shown);
    const row = header(shown.title, action ? [count, busy, end, action] : [count, busy, end]);
    // The layout's refusals and the panel's own are one list, drawn the same way.
    if (problems.length > 0) content.prepend(row, problemList(problems));
    else content.prepend(row);
  }
  // Shown even while it says it cannot run, so a check that passes later runs it where it stands.
  if (!place.folded && shown.problems.length === 0) onShow.add(shown.key);
  const notes = [...group.notes, ...(stateNotes[group.id] ?? []), ...slots.flatMap((slot) => [...slot.notes, ...(mounted.get(slot.key)?.notes ?? [])])];
  if (notes.length > 0) content.append(notesLine(notes));

  const rail = switcher(group, slots, shown, place);
  if (!rail) {
    section.append(content);
    return section;
  }
  // A folded group is its rail: the content stays in place, hidden, so every panel keeps its DOM.
  content.hidden = place.folded;
  section.classList.add('with-rail', place.axis === 'rows' ? 'horizontal' : 'vertical');
  if (place.edge === 'start') section.append(rail, content);
  else section.append(content, rail);
  return section;
}

/**
 * THE SWITCHER (P9): a group with several panels, or a folded group, shows a rail of icons on the edge it folds toward, so the rail stays where it is when the rest folds away.
 * An icon's tooltip names the panel and its dot says it waits or failed (P8); a click shows that panel, unfolding the group, and a click on the panel already on show folds the group, as its chevron does.
 * Null for a group with one panel on show, which needs no switching.
 */
function switcher(group: ResolvedGroup, slots: PanelSlot[], shown: PanelSlot, place: Place): HTMLElement | null {
  if (slots.length < 2 && !place.folded) return null;
  const rail = element('div', `panel-rail ${place.axis === 'rows' ? 'horizontal' : 'vertical'} ${place.edge}`);
  for (const slot of slots) {
    const item = element('button', 'icon-btn rail-item');
    item.type = 'button';
    // `alert` for a panel that cannot run, whoever said so: the layout (already in the slot's icon) or the panel itself.
    item.innerHTML = iconSvg((mounted.get(slot.key)?.problems.length ?? 0) > 0 ? 'alert' : slot.icon);
    const isShown = slot === shown && !place.folded;
    // One label for the tooltip and a screen reader, so neither is told less than the other; a count the rail can only show as "99+" is said whole here.
    const counted = mounted.get(slot.key)?.countValue;
    const named = counted === null || counted === undefined ? slot.title : `${slot.title} · ${counted}`;
    const label = isShown && place.toggleFold ? `${named} — click to fold` : named;
    item.setAttribute('aria-label', label);
    setTooltip(item, label);
    if (isShown) {
      item.classList.add('shown');
      // Nothing for a click to do in a group that cannot fold, so no hover to claim one.
      item.classList.toggle('no-fold', !place.toggleFold);
      item.setAttribute('aria-current', 'true');
    }
    const entry = slot.problems.length === 0 ? mounted.get(slot.key) : undefined;
    if (entry) item.append(entry.badge, entry.railCount);
    item.addEventListener('click', () => {
      if (isShown) {
        place.toggleFold?.();
        return;
      }
      keep([
        { id: group.id, field: 'active', value: keptOver(slot.key, group.active) },
        ...(foldedNow(group) ? [{ id: group.id, field: 'folded' as const, value: keptOver(false, group.folded) }] : []),
      ]);
      render();
    });
    rail.append(item);
  }
  return rail;
}

/** The mounted panel for a slot, mounting it on first sight. */
function mountedFor(slot: PanelSlot): Mounted {
  const existing = mounted.get(slot.key);
  if (existing) return existing;
  const type = types[slot.type!]!;
  const busy = element('span', badgeClass('busy'));
  busy.hidden = true;
  const end = element('span', 'panel-end');
  // Per entry, since what the button would do can depend on the options: a terminal pinned to a folder has none.
  const label = type.bare ? null : type.actionLabel ? type.actionLabel(optionsOf(slot.entry)) : 'Refresh';
  const action = label === null ? null : actionButton(label);
  const badge = element('span', badgeClass(null));
  badge.hidden = true;
  const count = element('span', 'panel-count');
  const railCount = element('span', 'rail-count');
  count.hidden = railCount.hidden = true;
  // What the panel reports about itself, held here so a report made while it is still mounting is not lost; a change re-renders, since both the panel's place and its rail icon draw from it.
  const said = { problems: [] as string[], notes: [] as string[] };
  const report = (field: keyof typeof said, lines: string[]): void => {
    if (lines.join('\n') === said[field].join('\n')) return;
    said[field] = lines;
    const current = mounted.get(slot.key);
    if (current) current[field] = lines;
    queueRender();
  };
  const panelHost: PanelHost = {
    where: () => host.where(),
    setBusy: (on) => {
      busy.hidden = !on;
    },
    setEnd: (label) => {
      end.textContent = label;
    },
    setStatus: (status) => showStatus(badge, status),
    setCount: (value) => {
      const current = mounted.get(slot.key);
      if (current?.countValue === value) return;
      if (current) current.countValue = value;
      count.hidden = railCount.hidden = value === null;
      count.textContent = value === null ? '' : String(value);
      // Two digits at most under a 24px icon; the rail's label, rebuilt by the render below, says the number whole.
      railCount.textContent = value === null ? '' : value > 99 ? '99+' : String(value);
      queueRender();
    },
    setProblems: (problems) => report('problems', problems),
    setNotes: (notes) => report('notes', notes),
    // The session links are remembered under the panel's own entry key.
    startSession: (request) => void startSession(slot.key, request, host.asks),
    linkedSessions: (itemKey) => linkedSessions(slot.key, itemKey),
    pickSession: (anchor, sessions) => pickSession(anchor, sessions, host.asks),
    ...host.asks,
  };
  const panel = type.mount(slot, panelHost);
  action?.addEventListener('click', () => panel.refresh());
  const entry: Mounted = { panel, signature: signatureOf(slot), busy, end, action, badge, count, railCount, countValue: null, ...said };
  mounted.set(slot.key, entry);
  return entry;
}

/** The rail dot, in the status dot's own states: `waiting` as a session's dot pulses, `failed` for a run that did not end well. */
function showStatus(badge: HTMLElement, status: PanelStatus): void {
  badge.className = badgeClass(status === 'wait' ? 'waiting' : status === 'fail' ? 'failed' : null);
  badge.hidden = status === null;
}

/** The header's one button, in the compact box: the header takes the tab bar's density, and a standard box made it taller than a header without one. */
function actionButton(label: string): HTMLButtonElement {
  const button = element('button', 'icon-btn compact');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  setTooltip(button, label);
  button.innerHTML = REFRESH_ICON;
  return button;
}

function header(title: string, controls: HTMLElement[] = []): HTMLElement {
  const row = element('div', 'panel-header');
  const heading = element('span', 'panel-title');
  heading.textContent = title;
  setTooltip(heading, title);
  row.append(heading, ...controls);
  return row;
}

/** A panel or node that cannot be drawn says why, one sentence per line, where its content would be. */
function problemList(problems: string[]): HTMLElement {
  const box = element('div', 'panel-problems');
  for (const problem of problems) {
    const line = element('p');
    line.textContent = problem;
    box.appendChild(line);
  }
  return box;
}

/** What the app did in the file's place, or does not honour yet, under the node it is about. */
function notesLine(notes: string[]): HTMLElement {
  const box = element('div', 'panel-note');
  for (const note of notes) {
    const line = element('div');
    line.textContent = note;
    box.appendChild(line);
  }
  return box;
}
