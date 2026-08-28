/**
 * Where the window should open, given what was stored and which screens exist right now.
 *
 * Kept apart from main.ts and free of any electron import, because the interesting part is geometry against a display layout that has changed since the window was last closed — a monitor unplugged, a laptop docked, WSLg handing out a different desktop size — and that is precisely the situation you cannot reproduce by hand on the machine you are developing on.
 * Pure input, pure output, so the awkward cases are tests instead of a window that opens somewhere you cannot see it.
 */

/** A stored window position. `maximized` is remembered separately from the size, which is always the UNMAXIMIZED one. */
export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** A display's usable area (`Display.workArea`: the screen minus panels and docks). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What to open with.
 * `x`/`y` are absent when the stored position is no longer on any screen — leaving them out lets the platform place the window itself, which is the sane fallback rather than a guess of our own.
 */
export interface Placement {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized: boolean;
}

/**
 * Below this the UI is unusable (the sidebar alone claims most of the width), so a stored size smaller than this is treated as damage rather than a preference.
 * Exported because the window itself must enforce the same floor: these were once only a repair applied when READING a stored size, while the window had no minimum at all, so a resize could take it to nothing and the repair only undid it on the next launch.
 */
export const MIN_WIDTH = 640;
export const MIN_HEIGHT = 420;

/**
 * How much of the window has to fall inside a screen for the stored position to be worth reusing.
 * A window can legitimately hang off an edge, but if this little of it lands on a display, the position is a leftover from a layout that no longer exists.
 */
const MIN_VISIBLE = 100;

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * Is this position still reachable?
 * Two conditions, and the second is the one that is easy to forget: enough of the window has to be on a screen to see it, AND its top edge has to be at or below the top of that screen, or the title bar is off-screen and the window cannot be dragged back into view — a window that is visible but immovable is worse than one that opens in the default spot.
 */
function onScreen(bounds: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((area) => {
    const { width, height } = overlap(bounds, area);
    return width >= MIN_VISIBLE && height >= MIN_VISIBLE && bounds.y >= area.y;
  });
}

/**
 * Turn stored bounds into arguments for a new window, or null when there is nothing usable stored (first run).
 *
 * Size and position are decided separately on purpose.
 * A size is a preference and survives a display change — the window was that big because the user made it that big; it is only clamped so it cannot be smaller than the UI can use or larger than the screen it is about to open on.
 * A position is only meaningful against the layout it was saved in, so it is dropped whole the moment it no longer lands somewhere reachable.
 */
export function placeWindow(saved: WindowBounds | null, workAreas: Rect[]): Placement | null {
  if (!saved) return null;
  // No displays reported at all: keep the stored size, place nothing. Not expected, but the alternative is dividing up an empty list.
  const largest = workAreas.reduce<Rect | null>((best, area) => (!best || area.width * area.height > best.width * best.height ? area : best), null);
  const width = Math.max(MIN_WIDTH, largest ? Math.min(saved.width, largest.width) : saved.width);
  const height = Math.max(MIN_HEIGHT, largest ? Math.min(saved.height, largest.height) : saved.height);
  // Checked at the CLAMPED size, since that is the window that will actually exist.
  const bounds = { x: saved.x, y: saved.y, width, height };
  const placement: Placement = { width, height, maximized: saved.maximized };
  if (onScreen(bounds, workAreas)) {
    placement.x = saved.x;
    placement.y = saved.y;
  }
  return placement;
}

/** How much smaller than a display's work area a maximized window has to be. Zero where nothing is reserved. */
export interface Inset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSET: Inset = { top: 0, right: 0, bottom: 0, left: 0 };

/** Which edge or corner a gesture is pulling, or `move` for dragging the whole window. */
export type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/**
 * The rectangle a maximized window should fill.
 *
 * Separate from the work area because nothing here publishes one that accounts for the Windows taskbar, so the reserved strip has to be measured and applied by hand.
 */
export function maximizedRect(workArea: Rect, inset: Inset = NO_INSET): Rect {
  return {
    x: workArea.x + inset.left,
    y: workArea.y + inset.top,
    width: workArea.width - inset.left - inset.right,
    height: workArea.height - inset.top - inset.bottom,
  };
}

/**
 * Turn a maximized probe's rectangle into the inset it implies, or null when the answer is not believable.
 *
 * The rejection is the point. The probe lands on whichever display the window manager chose, so measuring it against a different display's work area produces a negative inset — which is not a smaller correction, it is a wrong one, and applying it would push the window off the screen.
 * `workArea` must therefore be the work area of the display the probe LANDED on.
 */
export function insetFromProbe(probe: Rect, workArea: Rect): Inset | null {
  const inset: Inset = {
    top: probe.y - workArea.y,
    left: probe.x - workArea.x,
    right: workArea.x + workArea.width - (probe.x + probe.width),
    bottom: workArea.y + workArea.height - (probe.y + probe.height),
  };
  const sides = [inset.top, inset.right, inset.bottom, inset.left];
  if (!sides.every((n) => n >= 0)) return null;
  // A reserved strip is a taskbar, not half the screen; anything larger means the probe answered about something else.
  if (inset.top + inset.bottom >= workArea.height / 2) return null;
  if (inset.left + inset.right >= workArea.width / 2) return null;
  return inset;
}

/**
 * Apply a resize or move gesture to the rectangle it started from.
 *
 * `dx`/`dy` are the TOTAL offset from where the gesture began, not the step since the last event: applying steps would measure each one against a window the previous step had already moved, which drifts.
 * Dragging the top or left edge moves the origin as well as the size, and the minimum has to clamp both together — clamping only the size lets the window keep travelling after it has stopped shrinking.
 */
export function resizeBy(start: Rect, edge: Edge, dx: number, dy: number, min = { width: MIN_WIDTH, height: MIN_HEIGHT }): Rect {
  if (edge === 'move') return { ...start, x: start.x + dx, y: start.y + dy };
  let { x, y, width, height } = start;
  if (edge.includes('e')) width = Math.max(min.width, start.width + dx);
  if (edge.includes('s')) height = Math.max(min.height, start.height + dy);
  if (edge.includes('w')) {
    width = Math.max(min.width, start.width - dx);
    x = start.x + (start.width - width);
  }
  if (edge.includes('n')) {
    height = Math.max(min.height, start.height - dy);
    y = start.y + (start.height - height);
  }
  return { x, y, width, height };
}

/**
 * Where a maximized window should land when a drag pulls it out of maximize.
 *
 * Restoring it to where it last sat leaves the pointer somewhere else entirely, so the window jumps away and the drag carries on from a place the cursor is not.
 * The cursor keeps its position ACROSS the window proportionally and its exact offset DOWN it, which is what every other title bar does.
 */
export function unmaximizeUnderPointer(maximized: Rect, restored: { width: number; height: number }, pointer: { x: number; y: number }): Rect {
  const ratioX = maximized.width > 0 ? (pointer.x - maximized.x) / maximized.width : 0.5;
  return {
    x: Math.round(pointer.x - ratioX * restored.width),
    y: maximized.y,
    width: restored.width,
    height: restored.height,
  };
}

/** Bigger than any title bar. A larger difference is the window manager placing the window by a policy of its own, or the user already dragging it — not a frame, and not ours to cancel. */
export const MAX_FRAME = 64;

/**
 * What to make of a reading while waiting for a window manager's frame offset to appear.
 *
 * `correct` once a frame-sized difference shows up, `wait` for anything else, and that distinction is the whole subtlety: two readings arrive before the real one — the position asked for, unchanged, and, while the window is not yet mapped, the far off-screen coordinates X11 parks it at, about -32700 on both axes.
 * Treating either as an answer is what once made this give up at 54ms and never see the offset that arrived at ~250ms.
 */
export function frameOffsetVerdict(dx: number, dy: number): 'correct' | 'wait' {
  if (dx === 0 && dy === 0) return 'wait';
  return Math.abs(dx) <= MAX_FRAME && Math.abs(dy) <= MAX_FRAME ? 'correct' : 'wait';
}
