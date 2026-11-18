import { element } from '../../../../ui/dom';
import { installSplitResizer } from '../../../../ui/resizer';
import { setTooltip } from '../../../../ui/tooltip';
import './dock.css';

/** The narrowest a drag leaves the docked history, and about what it leaves the terminals, while the pane has room for both. */
const MIN_WIDTH = 160;

/**
 * The column beside the tab's terminal that the history docks in, with a divider between them that drags its width.
 * It holds what it is given, and is in the window only while it holds something; where the history goes, here or the drawer, is the pane's call (pane.ts).
 * Its width starts at about the drawer's (dock.css), until it is dragged.
 */
export class HistoryDock {
  readonly divider = element('div', 'divider drag between-columns history-dock-divider');
  readonly column = element('div', 'history-dock');

  /** Docked, it goes right after `terminals`; `widthKept` hears the width a drag ended at, to keep for the window. */
  constructor(
    private readonly terminals: HTMLElement,
    widthKept: (px: number) => void,
  ) {
    setTooltip(this.divider, 'Drag to resize');
    let start = 0;
    let room = 0;
    let dragged: number | null = null;
    installSplitResizer(this.divider, {
      axis: 'x',
      onStart: () => {
        start = this.column.offsetWidth;
        // The terminals give up what the column takes.
        room = start + this.divider.offsetWidth + this.terminals.offsetWidth;
        dragged = null;
      },
      onMove: (delta) => {
        dragged = Math.round(Math.min(room - MIN_WIDTH, Math.max(MIN_WIDTH, start - delta)));
        this.setWidth(dragged);
      },
      onEnd: () => {
        if (dragged !== null) widthKept(dragged);
      },
    });
  }

  /** The column's width in px, or null for the drawer's. */
  setWidth(px: number | null): void {
    this.column.style.flexBasis = px === null ? '' : `${px}px`;
  }

  holds(el: HTMLElement): boolean {
    return el.parentElement === this.column;
  }

  /** Show `el` docked, in place of anything it held. */
  hold(el: HTMLElement): void {
    if (!this.holds(el)) this.column.replaceChildren(el);
    if (!this.column.isConnected) this.terminals.after(this.divider, this.column);
  }

  /** Give up what it holds, and leave the window. */
  empty(): void {
    this.column.replaceChildren();
    this.divider.remove();
    this.column.remove();
  }
}
