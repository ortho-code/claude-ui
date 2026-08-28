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

/** Below this the UI is unusable (the sidebar alone claims most of the width), so a stored size smaller than this is treated as damage rather than a preference. */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 420;

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
