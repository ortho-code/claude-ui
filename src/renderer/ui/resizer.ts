import './resizer.css';

/**
 * Drag a divider between two children of a split.
 *
 * One helper for every draggable edge in the window, because the mousedown / mousemove / mouseup dance is exactly the kind of code that gets copied and then drifts: a clamp changed in one copy, the body class forgotten in the other.
 * It reports only how far the pointer has travelled along the axis since the drag began; what that does to the sizes is `dragTo`'s business (panels/sizes.ts), so the arithmetic stays pure and tested.
 */
export interface SplitResizerOptions {
  /** Which way the divider moves: `x` between columns, `y` between rows. */
  axis: 'x' | 'y';
  /** The drag began: measure what the move will need. */
  onStart(): void;
  /** The pointer is `delta` px along the axis from where the drag began, positive towards the end. */
  onMove(delta: number): void;
  /** The drag ended: where the sizes get persisted. */
  onEnd(): void;
}

export function installSplitResizer(handle: HTMLElement, options: SplitResizerOptions): void {
  const horizontal = options.axis === 'x';
  handle.addEventListener('mousedown', (event) => {
    // A control sitting on the divider (a fold chevron) is a click, not the start of a drag.
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button'))) return;
    event.preventDefault();
    const start = horizontal ? event.clientX : event.clientY;
    options.onStart();
    document.body.classList.add('resizing');
    // The handle's own cursor, so a horizontal divider and a vertical one each keep theirs over everything the pointer crosses during the drag.
    document.body.style.cursor = getComputedStyle(handle).cursor;
    handle.classList.add('dragging');
    const onMove = (move: MouseEvent): void => options.onMove((horizontal ? move.clientX : move.clientY) - start);
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      handle.classList.remove('dragging');
      options.onEnd();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
