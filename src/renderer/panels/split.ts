import { keptOver } from '../../shared/sessions/kept';
import { spelledSize, type NodeSize } from '../../shared/panels';
import { element } from '../ui/dom';
import { drawFoldChevron, foldChevron } from '../ui/fold-chevron';
import { installSplitResizer } from '../ui/resizer';
import type { Direction } from '../ui/svg';
import { setTooltip } from '../ui/tooltip';
import { foldEdge, isEmpty, type ResolvedGroup, type ResolvedNode, type ResolvedSplit } from './layout';
import { dragTargets, flexFor, sizesAfterDrag, type FlexChild } from './sizes';
import { notesLine } from './headers';
import { foldedNow, keep, sizesOf, stateNotesOf, stateOf } from './treestate';
import './split.css';

/**
 * A split of the window, drawn: its children side by side or stacked, sized from the file and the app's sizes over it, and the dividers between them, which resize, reset and fold.
 * The arithmetic is sizes.ts's; this measures and applies.
 */

/**
 * Where a child sits in its split: along which axis, which edge it folds toward, whether it is folded, and how to fold or unfold it — null for a child that cannot.
 * The root has no axis and cannot fold.
 */
export interface Place {
  axis: 'rows' | 'columns' | null;
  edge: 'start' | 'end';
  folded: boolean;
  toggleFold: (() => void) | null;
}

/** What drawing a split asks of the tree it is in. */
export interface SplitContext {
  /** Draw a child where the split places it, a split or a group. */
  node(node: ResolvedNode, place: Place): HTMLElement;
  /** The panel filling the window, by key; null for none. */
  fullScreen(): string | null;
  /** Draw the whole tree again, after a fold or a reset of sizes. */
  render(): void;
}

/**
 * A group that can fold: it asks to, and is not degraded.
 * Whether it has a divider to fold from is the split's to say.
 */
export const foldable = (node: ResolvedNode): node is ResolvedGroup => node.kind === 'group' && node.collapsible && node.problems.length === 0;

/** Whether `node` is, or holds, the group that places the panel `key`. */
function holds(node: ResolvedNode, key: string): boolean {
  return node.kind === 'split' ? node.children.some((child) => holds(child, key)) : node.slots.some((slot) => slot.key === key);
}

export function renderSplit(split: ResolvedSplit, context: SplitContext): HTMLElement {
  const visible = split.children.filter((child) => !isEmpty(child));
  const edges = visible.map((_, index) => foldEdge(visible, index));
  // The child on the way to the panel filling the window takes the whole split, open; its siblings and the dividers stay placed, hidden.
  const fullScreen = context.fullScreen();
  const filling = fullScreen === null ? undefined : visible.find((child) => holds(child, fullScreen));
  const folded = visible.map((child) => child !== filling && foldable(child) && foldedNow(child));
  const box = element('div', `split ${split.axis}`);
  const nodes: HTMLElement[] = [];
  // One fold per child that has a divider to fold from, behind both its chevron and its rail, so the two cannot fold it differently.
  const toggles = visible.map((child, index) => (visible.length > 1 && foldable(child) ? () => toggleFold(visible, folded, index, context) : null));
  visible.forEach((child, index) => {
    if (index > 0) {
      const handle = divider(split, visible, nodes, edges, folded, toggles, index - 1, index, context);
      handle.hidden = filling !== undefined;
      box.append(handle);
    }
    const node = element('div', 'node');
    node.append(context.node(child, { axis: split.axis, edge: edges[index]!, folded: folded[index]!, toggleFold: toggles[index] ?? null }));
    node.hidden = filling !== undefined && child !== filling;
    nodes.push(node);
    box.append(node);
  });
  applyFlex(split, visible, nodes, folded);
  if (filling !== undefined) {
    const style = nodes[visible.indexOf(filling)]!.style;
    style.flex = '1 1 0';
    style.minWidth = style.minHeight = '';
  }
  const notes = [...split.notes, ...stateNotesOf(split.id)];
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
function divider(split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], edges: Place['edge'][], folded: boolean[], toggles: Place['toggleFold'][], a: number, b: number, context: SplitContext): HTMLElement {
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
    const kept = split.children.filter((child) => stateOf(child.id)?.size !== undefined);
    if (kept.length === 0) return;
    keep(kept.map((child) => ({ id: child.id, field: 'size', value: null })));
    context.render();
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
 * THE FOLD CONTROL (P7, P12): the fold chevron (fold-chevron.ts) on the divider on the other side of the edge a group folds toward, pointing the way it moves, and turned round while it is folded.
 * Two on one divider — two foldable groups alone in a split — sit one after the other along the line, each pointing into its own group, so neither covers a header; hovering one outlines the group it acts on.
 * Faint until the pointer is on the divider (fold-chevron.css, split.css), so a window of foldable groups is not a row of buttons.
 */
function foldControls(handle: HTMLElement, split: ResolvedSplit, visible: ResolvedNode[], nodes: HTMLElement[], edges: Place['edge'][], folded: boolean[], toggles: Place['toggleFold'][], a: number, b: number): void {
  const riders = [a, b].filter((index) => toggles[index] && edges[index] === (index === a ? 'start' : 'end'));
  const horizontal = split.axis === 'columns';
  for (const index of riders) {
    const group = visible[index]!;
    const toward: Direction = horizontal ? (edges[index] === 'start' ? 'left' : 'right') : edges[index] === 'start' ? 'up' : 'down';
    const chevron = foldChevron(horizontal ? 'vertical' : 'horizontal');
    chevron.classList.add(index === a ? 'before' : 'after');
    if (riders.length === 2) chevron.classList.add('shared');
    drawFoldChevron(chevron, folded[index] ? OPPOSITE[toward] : toward, `${folded[index] ? 'Unfold' : 'Fold'} ${group.id}`);
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
function toggleFold(visible: ResolvedNode[], folded: boolean[], index: number, context: SplitContext): void {
  const group = visible[index] as ResolvedGroup;
  keep([{ id: group.id, field: 'folded', value: keptOver(!folded[index], group.folded) }]);
  context.render();
}
