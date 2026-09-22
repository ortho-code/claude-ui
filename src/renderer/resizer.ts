/**
 * Drag a divider to resize the flex item beside it.
 *
 * One helper for every draggable edge — the sidebar's today, a panel side's next — because the mousedown / mousemove / mouseup dance is exactly the kind of code that gets copied and then drifts: a clamp changed in one copy, the body class forgotten in the other.
 * The handle's position decides the direction on its own: a target that sits BEFORE the handle keeps its start edge and grows towards the pointer, one AFTER it keeps its end edge and grows away from it. Nothing has to say which.
 */
export interface ResizerOptions {
  /** The flex item whose basis the drag sets. */
  target: HTMLElement;
  /** Which way the divider moves: `x` sets a width, `y` a height. */
  axis: 'x' | 'y';
  min: number;
  max: number;
  /** Runs once when the drag ends, with the final size — where the size gets persisted. */
  onEnd: (size: number) => void;
}

export function installResizer(handle: HTMLElement, options: ResizerOptions): void {
  const { target, axis, min, max, onEnd } = options;
  const horizontal = axis === 'x';
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    const box = target.getBoundingClientRect();
    const handleBox = handle.getBoundingClientRect();
    const before = horizontal ? box.left < handleBox.left : box.top < handleBox.top;
    const start = horizontal ? box.left : box.top;
    const end = horizontal ? box.right : box.bottom;
    let size = horizontal ? box.width : box.height;
    document.body.classList.add('resizing');
    // The handle's own cursor, so a horizontal divider and a vertical one each keep theirs over everything the pointer crosses during the drag.
    document.body.style.cursor = getComputedStyle(handle).cursor;
    handle.classList.add('dragging');
    const onMove = (move: MouseEvent): void => {
      const pointer = horizontal ? move.clientX : move.clientY;
      size = Math.min(max, Math.max(min, before ? pointer - start : end - pointer));
      target.style.flexBasis = `${size}px`;
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('resizing');
      document.body.style.cursor = '';
      handle.classList.remove('dragging');
      onEnd(size);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}
