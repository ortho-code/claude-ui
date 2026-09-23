import type { LayoutReport, PanelState } from '../../shared/panels';
import { installSplitResizer } from '../resizer';
import { setTooltip } from '../tooltip';
import {
  DEFAULT_LAYOUT,
  fileName,
  isEmpty,
  mountSignature,
  resolveLayout,
  type PanelSlot,
  type ResolvedGroup,
  type ResolvedNode,
  type ResolvedSplit,
} from './layout';
import { dragTo, flexFor, keptSizes, type FlexChild } from './sizes';
import { claudeType, sessionsType } from './types/builtin';
import { commandType, type MountedPanel, type PanelHost, type PanelStatus, type PanelType, type Where } from './types/command';
import { terminalType } from './types/terminal';

/**
 * The window, drawn from the layout tree: nested rows and columns of groups, each group showing one panel, with the app's own sidebar and terminal area as two of the panels.
 *
 * Built from main's report of the layout file and rebuilt whenever that file changes. A rebuild recreates the splits, dividers and headers, but NEVER a panel: mounted panels are kept by entry key and moved into their new place, so a save that adds a panel restarts nothing else (decision 13). The built-ins are the elements the app has always had, moved in the same way.
 * Before the first read the tree is the default layout, drawn synchronously at start-up, so the first paint is already the window as it will be without a file.
 * Panels are mounted hidden and not shown until `startPanels`, which the renderer calls once the tabs are restored, so a panel's first run is in the restored tab's folder.
 */

const TYPES: Record<string, PanelType> = { sessions: sessionsType, claude: claudeType, command: commandType, terminal: terminalType };

/** What the tree needs from the renderer: where a panel would run, the toast, and the view-state write. */
export interface TreeHost {
  where(): Where;
  showToast(message: string, sticky?: boolean): void;
  hideToast(): void;
  persist(): void;
}

/** A panel on screen, and the header marks it reports through — made once with it, so a rebuilt header shows the same marks rather than orphaning them. */
interface Mounted {
  panel: MountedPanel;
  /** Its type and declared parameters: a change to either mounts it afresh, a change to anything else (title, icon) does not. */
  signature: string;
  busy: HTMLElement;
  end: HTMLElement;
  action: HTMLButtonElement | null;
  /** The dot on its rail icon (P8). */
  badge: HTMLElement;
}

const REFRESH_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.49" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 8.6A4.8 4.8 0 1 1 11.6 4.5" /><path d="M12.9 2.8v2.6h-2.6" /></svg>';

let host: TreeHost;
let app: HTMLElement;
/** The last report read, whatever it said: the config folder's path is right in every one. Null until the first read. */
let report: LayoutReport | null = null;
/** The tree on screen: the last good read, or the default layout until there is one. */
let tree: ResolvedNode;
const mounted = new Map<string, Mounted>();
/** The keys of the panels the last render put on show, as opposed to mounted behind another. */
let onShow = new Set<string>();
let sizes: PanelState['sizes'] = {};
/** Kept as restored and written back unchanged until folding and the rail use them (phase 4), so nothing stored is lost in between. */
let collapsed: string[] = [];
let active: PanelState['active'] = {};
/** Whether panels may be shown, which is when they first run. */
let live = false;
/** Whether the toast up right now is the tree's, so a good read takes it down without touching anybody else's. */
let toasted = false;

/** Draw the default layout now, before the first paint, and follow the layout file from here on. */
export function initTree(treeHost: TreeHost): void {
  host = treeHost;
  app = document.getElementById('app')!;
  const view = resolveLayout({ configRoot: '', file: '', status: 'missing', error: null, json: null, scripts: {} }, TYPES);
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

/** The config folder, for the settings dialog; null until the first report has arrived. */
export function configRoot(): string | null {
  return report?.configRoot ?? null;
}

/** The tab or project changed: let every panel decide whether that moved its context. A hidden one only notes it (RunGate). */
export function treeContextChanged(): void {
  for (const { panel } of mounted.values()) panel.contextChanged();
}

export function treeState(): PanelState {
  return { sizes, collapsed: [...collapsed], active: { ...active } };
}

/**
 * Put the tree's state back as it was left.
 * `legacySidebarWidth` is the sidebar's width from before the sidebar was a node in the tree: adopted ONCE into the default layout's root split when that split has no sizes yet, so an existing install keeps its sidebar, and never again.
 */
export function restoreTreeState(state: PanelState, legacySidebarWidth: number | null): void {
  sizes = { ...state.sizes };
  collapsed = [...state.collapsed];
  active = { ...state.active };
  const root = DEFAULT_LAYOUT.root;
  if (!sizes[root.id] && 'columns' in root) {
    const [sidebar, main] = root.columns;
    // A width the sidebar could not have been dragged to is damage, not a preference.
    const width = legacySidebarWidth ?? 0;
    const usable = width >= (sidebar.min ?? 0) && width < window.innerWidth;
    // The terminal's px only weigh it against nothing, as the one child without a pixel size; the rest of the window is the honest number.
    if (usable) sizes[root.id] = { [sidebar.id]: width, [main.id]: window.innerWidth - width };
  }
  render();
}

function apply(next: LayoutReport): void {
  // Kept whatever the read found: the folder's path is right in every report, and the settings dialog asks for it.
  report = next;
  const view = resolveLayout(next, TYPES);
  // A file that does not parse keeps the last good layout up: the message names the file and the parser's position, and stays until a read succeeds, because the condition does not clear on its own.
  if (view.kind === 'unparsable') {
    host.showToast(`${fileName(view.file)}: ${view.message}`, true);
    toasted = true;
    return;
  }
  if (toasted) {
    host.hideToast();
    toasted = false;
  }
  tree = view.root;
  render();
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
  app.replaceChildren(renderNode(tree));
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
  for (const slot of node.slots) if (!slot.hidden && slot.problems.length === 0) into.set(slot.key, mountSignature(slot, TYPES));
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

function renderNode(node: ResolvedNode): HTMLElement {
  return node.kind === 'split' ? renderSplit(node) : renderGroup(node);
}

function renderSplit(split: ResolvedSplit): HTMLElement {
  const visible = split.children.filter((child) => !isEmpty(child));
  const box = element('div', `split ${split.axis}`);
  const nodes: HTMLElement[] = [];
  visible.forEach((child, index) => {
    if (index > 0) box.append(divider(split, visible, nodes, index - 1, index));
    const node = element('div', 'node');
    node.append(renderNode(child));
    nodes.push(node);
    box.append(node);
  });
  applyFlex(split, visible, nodes);
  if (split.notes.length === 0) return box;
  const wrap = element('div', 'split-wrap');
  wrap.append(box, notesLine(split.notes));
  return wrap;
}

function flexChildren(visible: ResolvedNode[]): FlexChild[] {
  return visible.map((child) => ({ id: child.id, size: child.size, min: child.min, folded: false }));
}

/** Size a split's children from the file and the dragged sizes (panels/sizes.ts decides; this applies). */
function applyFlex(split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[]): void {
  const stored = keptSizes(sizes[split.id], visible.map((child) => child.id));
  // Dropped whole once its children changed — but only against a tree read from the file: the default layout drawn before the first read would otherwise wipe the sizes of the file's own splits at every start.
  if (report && !stored && sizes[split.id]) {
    delete sizes[split.id];
    host.persist();
  }
  const horizontal = split.axis === 'columns';
  flexFor(flexChildren(visible), stored).forEach((value, index) => {
    const style = nodes[index].style;
    style.flex = value.flex;
    style.minWidth = horizontal && value.min !== null ? `${value.min}px` : '';
    style.minHeight = !horizontal && value.min !== null ? `${value.min}px` : '';
  });
}

/**
 * The divider between two neighbours. Always there; draggable only when both are resizable, and one that is not says why on hover, so it does not read as broken (P11).
 */
function divider(split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], a: number, b: number): HTMLElement {
  const handle = element('div', 'divider');
  const fixed = [visible[a], visible[b]].filter((node) => !node.resizable).map((node) => node.id);
  if (fixed.length > 0) {
    setTooltip(handle, `Fixed size: ${fixed.join(' and ')} ${fixed.length === 1 ? 'has' : 'have'} "resizable": false`);
    return handle;
  }
  handle.classList.add('drag');
  setTooltip(handle, 'Drag to resize');
  const horizontal = split.axis === 'columns';
  let measured: number[] = [];
  installSplitResizer(handle, {
    axis: horizontal ? 'x' : 'y',
    onStart: () => {
      measured = nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return horizontal ? box.width : box.height;
      });
    },
    onMove: (delta) => {
      sizes[split.id] = dragTo(flexChildren(visible), measured, a, b, delta, sizes[split.id]);
      applyFlex(split, visible, nodes);
    },
    onEnd: () => host.persist(),
  });
  return handle;
}

/**
 * The slot a group shows. Until the rail lands (phase 4) a group shows one panel and cannot switch, so a built-in in it is the one shown — it must stay reachable — and otherwise the file's `active`.
 */
function shownSlot(group: ResolvedGroup, slots: PanelSlot[]): PanelSlot {
  const builtin = slots.find((slot) => slot.problems.length === 0 && TYPES[slot.type!].singleton);
  return builtin ?? slots.find((slot) => slot.key === group.active) ?? slots[0];
}

function renderGroup(group: ResolvedGroup): HTMLElement {
  const section = element('section', 'panel-group');
  if (group.problems.length > 0) {
    section.append(header(`⚠ ${group.title}`), problemList(group.problems));
    if (group.notes.length > 0) section.append(notesLine(group.notes));
    return section;
  }
  const slots = group.slots.filter((slot) => !slot.hidden);
  const shown = shownSlot(group, slots);
  for (const slot of slots) {
    if (slot.problems.length > 0) continue;
    const { panel } = mountedFor(slot);
    // Every panel of the group is placed, the ones not on show hidden, so each keeps its DOM and its process.
    panel.el.hidden = slot !== shown;
    section.append(panel.el);
  }
  if (shown.problems.length > 0) {
    section.prepend(header(shown.title), problemList(shown.problems));
  } else if (!TYPES[shown.type!].bare) {
    const { busy, end, action } = mountedFor(shown);
    section.prepend(header(shown.title, action ? [busy, end, action] : [busy, end]));
  }
  if (shown.problems.length === 0) onShow.add(shown.key);
  const notes = [...group.notes, ...slots.flatMap((slot) => slot.notes)];
  const others = slots.filter((slot) => slot !== shown);
  if (others.length > 0) notes.push(`Only one panel is shown yet; this group also has ${others.map((slot) => slot.key).join(', ')}.`);
  if (notes.length > 0) section.append(notesLine(notes));
  return section;
}

/** The mounted panel for a slot, mounting it on first sight. */
function mountedFor(slot: PanelSlot): Mounted {
  const existing = mounted.get(slot.key);
  if (existing) return existing;
  const type = TYPES[slot.type!];
  const busy = element('span', 'nudge busy');
  busy.hidden = true;
  const end = element('span', 'panel-end');
  const action = type.bare ? null : actionButton(type);
  const badge = element('span', 'nudge');
  badge.hidden = true;
  const panelHost: PanelHost = {
    where: () => host.where(),
    setBusy: (on) => {
      busy.hidden = !on;
    },
    setEnd: (label) => {
      end.textContent = label;
    },
    setStatus: (status) => showStatus(badge, status),
  };
  const panel = type.mount(slot, panelHost);
  action?.addEventListener('click', () => panel.refresh());
  const entry: Mounted = { panel, signature: mountSignature(slot, TYPES), busy, end, action, badge };
  mounted.set(slot.key, entry);
  return entry;
}

/** The rail dot, in the status dot's own states: `waiting` as a session's dot pulses, `failed` for a run that did not end well. */
function showStatus(badge: HTMLElement, status: PanelStatus): void {
  badge.className = status === 'wait' ? 'nudge waiting' : status === 'fail' ? 'nudge failed' : 'nudge';
  badge.hidden = status === null;
}

function actionButton(type: PanelType): HTMLButtonElement {
  const button = element('button', 'icon-btn');
  button.type = 'button';
  const label = type.actionLabel ?? 'Refresh';
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

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
