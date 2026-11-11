import { keptOver } from '../../shared/sessions/kept';
import type { LayoutReport, NodeStateChange } from '../../shared/panels';
import { element } from '../ui/dom';
// A panel header's count wears the section heading's count pill.
import '../ui/card.css';
import '../ui/badge.css';
import { foldable, renderSplit, type Place, type SplitContext } from './split';
import './tree.css';
import { setTooltip } from '../ui/tooltip';
import { iconSvg } from './icons';
import { fileName, mountSignature, resolveLayout, type PanelSlot, type ResolvedGroup, type ResolvedNode } from './layout';
import { claudeType } from './types/claude';
import { sessionsType } from './types/sessions';
import { folderTypes } from './types/folder';
import { mountPanel, type MountContext, type Mounted } from './mount';
import type { Asks, PanelType, Where } from './contract';
import { commandType } from './types/command';
import { terminalType } from './types/terminal';
import { drawFullScreenButton, header, notesLine, problemList, tabsHeader } from './headers';
import { foldedNow, initTreeState, keep, stateFileNotesNow, stateNotesOf, stateOf, takeState } from './tree-state';

/**
 * The window, drawn from the layout tree: nested rows and columns of groups, each group showing one panel, with the app's own sidebar and terminal area as two of the panels.
 *
 * Built from main's report of the layout file and rebuilt whenever that file changes, a group folds, or another panel is picked.
 * A rebuild recreates the splits, dividers, rails and headers, but NEVER a panel: mounted panels are kept by entry key and moved into their new place, so a save that adds a panel restarts nothing else (decision 13).
 * The built-ins are the elements the app has always had, moved in the same way.
 * Before the first read the tree is the default layout, drawn synchronously at start-up, so the first paint is already the window as it will be without a file.
 * Panels are mounted hidden and not shown until `startPanels`, which the renderer calls once the tabs are restored, so a panel's first run is in the restored tab's folder.
 *
 * Two choices tried in the playground and open to change sit in one function each, so swapping to another variant is a local change: `foldControls` (the chevron on the divider, P7/P12, split.ts) and `switcher` (the rail of icons, P9).
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

let host: TreeHost;
let app: HTMLElement;
/** The tree on screen: the last good read, or the default layout until there is one. */
let tree: ResolvedNode;
const mounted = new Map<string, Mounted>();
/** The keys of the panels the last render put on show, as opposed to mounted behind another or folded away. */
let onShow = new Set<string>();
/** Whether panels may be shown, which is when they first run. */
let live = false;
/** The toast the tree last put up, so a good read takes down that one and never anybody else's. */
let toasted: string | null = null;
/** A render asked for by a panel reporting something new, run once the current task is done so a report made during a render never renders inside it. */
let renderQueued = false;
/**
 * The panel filling the window, by entry key, or null for the layout as it stands.
 * Every other node stays mounted and placed, hidden, and nothing about it is written, so going back is the layout exactly as it was; never kept, so a launch starts with the layout.
 */
let fullScreen: string | null = null;

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
  host = { ...treeHost, asks: leavingFullScreen(treeHost.asks) };
  initTreeState(() => tree, host);
  app = document.getElementById('app')!;
  const view = resolveLayout(
    { configRoot: '', file: '', status: 'missing', error: null, json: null, types: [], local: { file: '', status: 'missing', error: null, json: null, byApp: false, stateMoved: true } },
    types,
  );
  if (view.kind === 'tree') tree = view.root;
  render();
  window.claudeUi.onLayoutChanged((next) => apply(next));
}

/**
 * The asks that open a session: each brings the terminal area into view first (`bringIntoView`), so the session's tab is on screen.
 * Inside a full-screen terminal area they keep it full screen, as following a session does: the session list keeps in step behind it, the way it does behind a folded sidebar.
 */
function leavingFullScreen(asks: Asks): Asks {
  const leave = (): void => bringTypeIntoView('claude');
  return {
    ...asks,
    openSession: (...args) => {
      leave();
      asks.openSession(...args);
    },
    openTab: (...args) => {
      leave();
      asks.openTab(...args);
    },
    openNewSession: (...args) => {
      leave();
      return asks.openNewSession(...args);
    },
    openWorktreeSession: (...args) => {
      leave();
      return asks.openWorktreeSession(...args);
    },
    forkSession: (...args) => {
      leave();
      return asks.forkSession(...args);
    },
  };
}

/** Bring the panel of type `type` into view, for a type the layout places once (`bringIntoView`). */
function bringTypeIntoView(type: string): void {
  const key = [...mounted.values()].find((entry) => entry.slot.type === type)?.slot.key;
  if (key !== undefined) bringIntoView(key);
}

/**
 * Bring the panel `key` into view: the layout back when another panel fills the window, its group unfolded, and the panel shown in its group, the fold and the pick kept as a rail click keeps them.
 * Draws only when something changed.
 */
function bringIntoView(key: string): void {
  const leave = fullScreen !== null && fullScreen !== key;
  if (leave) fullScreen = null;
  const group = groupHolding(tree, key);
  const changes: NodeStateChange[] = [];
  if (group) {
    if (shownSlot(group, group.slots.filter((slot) => !slot.hidden)).key !== key) changes.push({ id: group.id, field: 'active', value: keptOver(key, group.active) });
    if (foldable(group) && foldedNow(group)) changes.push({ id: group.id, field: 'folded', value: keptOver(false, group.folded) });
  }
  if (changes.length > 0) keep(changes);
  if (leave || changes.length > 0) render();
}

/** The group that places the panel `key`. */
function groupHolding(node: ResolvedNode, key: string): ResolvedGroup | undefined {
  if (node.kind === 'group') return node.slots.some((slot) => slot.key === key) ? node : undefined;
  for (const child of node.children) {
    const found = groupHolding(child, key);
    if (found) return found;
  }
  return undefined;
}

/** Put the panel `key` full screen, or go back to the layout for null. */
function setFullScreen(key: string | null): void {
  fullScreen = key;
  render();
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
 * A hidden one that has never run waits for its reveal (RunGate).
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
  // A panel the layout lets go of, or now refuses, cannot fill the window: the layout comes back.
  if (fullScreen !== null && !wanted.has(fullScreen)) fullScreen = null;
  // Moving an element resets its scroll offsets and drops its focus, so both are carried across the rebuild.
  const focused = document.activeElement;
  const scrolled = scrollOffsets();
  onShow = new Set();
  const root = renderNode(tree, { axis: null, edge: 'start', folded: false, toggleFold: null });
  // What is wrong with the app's file as a whole, under the window, as a file-wide problem of the layout's is.
  const fileNotes = stateFileNotesNow();
  if (fileNotes.length === 0) app.replaceChildren(root);
  else {
    const wrap = element('div', 'split-wrap');
    wrap.append(root, notesLine(fileNotes));
    app.replaceChildren(wrap);
  }
  for (const [el, top, left] of scrolled) {
    el.scrollTop = top;
    el.scrollLeft = left;
  }
  if (focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  // The groups it hides still say what they show; only the panel filling the window is on show.
  if (fullScreen !== null) onShow = new Set([...onShow].filter((key) => key === fullScreen));
  for (const [key, entry] of mounted) drawFullScreenButton(entry.fullScreenButton, key === fullScreen);
  showPanels();
  // A panel whose pick moved without mounting it afresh, by an edit of its entry's `view` or the app's file read after it mounted, is told so.
  for (const entry of mounted.values()) {
    const now = entry.view();
    if (now === entry.viewTold) continue;
    entry.viewTold = now;
    entry.panel.viewChanged?.();
  }
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
  return node.kind === 'split' ? renderSplit(node, splitting) : renderGroup(node, place);
}

/** What drawing a split asks of the tree. */
const splitting: SplitContext = {
  node: renderNode,
  fullScreen: () => fullScreen,
  render,
};

/**
 * The slot a group shows: the one picked there, else the file's `active`, else the first.
 * Every slot is reachable from the rail, so nothing — the terminal included — can be stranded behind another.
 */
function shownSlot(group: ResolvedGroup, slots: PanelSlot[]): PanelSlot {
  return slots.find((slot) => slot.key === stateOf(group.id)?.active) ??slots.find((slot) => slot.key === group.active) ?? slots[0]!;
}

function renderGroup(group: ResolvedGroup, place: Place): HTMLElement {
  const section = element('section', 'panel-group');
  if (group.problems.length > 0) {
    section.append(header(`⚠ ${group.title}`), problemList(group.problems));
    if (group.notes.length > 0) section.append(notesLine(group.notes));
    return section;
  }
  const slots = group.slots.filter((slot) => !slot.hidden);
  // The panel filling the window is the one its group shows, without the rail, so nothing switches or folds until it goes back.
  const filling = slots.find((slot) => slot.key === fullScreen);
  const shown = filling ?? shownSlot(group, slots);
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
    const { count, folder, busy, end, views, action, problems, tabs, fullScreenButton } = mountedFor(shown);
    const controls = [busy, end, views, ...(action ? [action] : []), fullScreenButton];
    // Tabs take the title's place, and its count and folder with it: the tabs are there to count, and each shell names its own folder.
    const row = tabs ? tabsHeader(tabs, controls) : header(shown.title, [folder, count, ...controls]);
    // The layout's refusals and the panel's own are one list, drawn the same way.
    if (problems.length > 0) content.prepend(row, problemList(problems));
    else content.prepend(row);
  }
  // Shown even while it says it cannot run, so a check that passes later runs it where it stands.
  if (!place.folded && shown.problems.length === 0) onShow.add(shown.key);
  const notes = [...group.notes, ...stateNotesOf(group.id), ...slots.flatMap((slot) => [...slot.notes, ...(mounted.get(slot.key)?.notes ?? []), ...(mounted.get(slot.key)?.viewNotes ?? [])])];
  if (notes.length > 0) content.append(notesLine(notes));

  const rail = filling ? null : switcher(group, slots, shown, place);
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
    const item = element('button', 'icon-btn rail-item dotted-icon');
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
  if (existing) {
    existing.slot = slot;
    return existing;
  }
  const entry = mountPanel(slot, mounting);
  mounted.set(slot.key, entry);
  return entry;
}

/** What a panel's mount asks of the tree. */
const mounting: MountContext = {
  get host() {
    return host;
  },
  typeOf: (name) => types[name]!,
  signatureOf,
  entry: (key) => mounted.get(key),
  queueRender,
  toggleFullScreen: (key) => setFullScreen(fullScreen === key ? null : key),
  bringIntoView,
};
