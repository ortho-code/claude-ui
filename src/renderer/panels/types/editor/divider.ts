import { element } from '../../../ui/dom';
import { installSplitResizer } from '../../../ui/resizer';
import { setTooltip } from '../../../ui/tooltip';

/** Lay `first` and `second` out side by side, `share` of the width the first's, or with null let them take the width as their stylesheet says. */
export function shareWidth(first: HTMLElement, second: HTMLElement | null, share: number | null): void {
  first.style.flex = share === null ? '' : `${share} 1 0px`;
  if (second) second.style.flex = share === null ? '' : `${1 - share} 1 0px`;
}

/**
 * The divider between the two groups of a split Editor: a drag shares the width between them as the pointer goes, and `shared` hears the share it ended at; a double click hears them made even.
 * How narrow a group may get is its stylesheet's (view.css), which holds after the drag too, when the Editor narrows.
 * `sides` names the two groups at the start of each drag.
 */
export function groupDivider(sides: () => [HTMLElement, HTMLElement] | null, shared: (share: number | null) => void): HTMLElement {
  const divider = element('div', 'divider drag between-columns editor-divider');
  setTooltip(divider, 'Drag to resize, double-click to make them even');
  let start = 0;
  let room = 0;
  let dragged: number | null = null;
  installSplitResizer(divider, {
    axis: 'x',
    onStart: () => {
      const both = sides();
      start = both?.[0].offsetWidth ?? 0;
      room = both ? both[0].offsetWidth + both[1].offsetWidth : 0;
      dragged = null;
    },
    onMove: (delta) => {
      const both = sides();
      if (!both || room === 0) return;
      dragged = Math.min(1, Math.max(0, (start + delta) / room));
      shareWidth(both[0], both[1], dragged);
    },
    onEnd: () => {
      if (dragged !== null) shared(dragged);
    },
  });
  divider.addEventListener('dblclick', () => shared(null));
  return divider;
}
