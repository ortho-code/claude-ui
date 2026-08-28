import { describe, it, expect } from 'vitest';
import {
  placeWindow,
  maximizedRect,
  insetFromProbe,
  resizeBy,
  unmaximizeUnderPointer,
  frameOffsetVerdict,
  MIN_WIDTH,
  MIN_HEIGHT,
} from './bounds';

const LAPTOP = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };
const saved = (over: Partial<{ x: number; y: number; width: number; height: number; maximized: boolean }> = {}) => ({
  x: 100,
  y: 80,
  width: 1400,
  height: 900,
  maximized: false,
  ...over,
});

describe('placeWindow', () => {
  it('has nothing to place on a first run', () => {
    expect(placeWindow(null, [LAPTOP])).toBeNull();
  });

  it('gives back a position that is still on a screen', () => {
    expect(placeWindow(saved(), [LAPTOP])).toEqual({ x: 100, y: 80, width: 1400, height: 900, maximized: false });
  });

  it('keeps a position on a second monitor while that monitor is there', () => {
    const bounds = saved({ x: 2200, y: 200 });
    expect(placeWindow(bounds, [LAPTOP, SECOND])).toMatchObject({ x: 2200, y: 200 });
  });

  it('drops the position, but keeps the size, when that monitor is gone', () => {
    const bounds = saved({ x: 2200, y: 200 });
    expect(placeWindow(bounds, [LAPTOP])).toEqual({ width: 1400, height: 900, maximized: false });
  });

  it('keeps a window that merely hangs off an edge', () => {
    // Half off the right of a single screen: still plenty to grab.
    expect(placeWindow(saved({ x: 1200 }), [LAPTOP])).toMatchObject({ x: 1200 });
  });

  it('drops a position with only a sliver on screen', () => {
    expect(placeWindow(saved({ x: 1880 }), [LAPTOP])).not.toHaveProperty('x');
  });

  it('drops a position whose title bar is above the screen, which could not be dragged back', () => {
    expect(placeWindow(saved({ y: -300 }), [LAPTOP])).not.toHaveProperty('y');
  });

  it('shrinks a size stored on a bigger screen to fit the one that is left', () => {
    const bounds = saved({ x: 2000, y: 100, width: 2400, height: 1300 });
    expect(placeWindow(bounds, [LAPTOP])).toEqual({ width: 1920, height: 1040, maximized: false });
  });

  it('refuses a size too small to use', () => {
    expect(placeWindow(saved({ width: 120, height: 60 }), [LAPTOP])).toMatchObject({ width: 640, height: 420 });
  });

  it('judges reachability at the clamped size, not the stored one', () => {
    // Stored 2400 wide at x=1850, so the stored rectangle overlaps the screen by only 70px; clamped to 1920 it overlaps by the same 70. Either way there is not enough on screen.
    expect(placeWindow(saved({ x: 1850, width: 2400 }), [LAPTOP])).not.toHaveProperty('x');
  });

  it('carries the maximized flag through', () => {
    expect(placeWindow(saved({ maximized: true }), [LAPTOP])).toMatchObject({ maximized: true });
  });

  it('keeps the stored size when no display is reported at all', () => {
    expect(placeWindow(saved(), [])).toEqual({ width: 1400, height: 900, maximized: false });
  });
});

describe('maximizedRect', () => {
  const area = { x: 0, y: 0, width: 3440, height: 1440 };

  it('fills the work area when nothing is reserved', () => {
    expect(maximizedRect(area)).toEqual({ x: 0, y: 0, width: 3440, height: 1440 });
  });

  it('keeps clear of a reserved strip at the bottom', () => {
    expect(maximizedRect(area, { top: 0, right: 0, bottom: 48, left: 0 })).toEqual({ x: 0, y: 0, width: 3440, height: 1392 });
  });

  it('is relative to the display, not the desktop', () => {
    const second = { x: 3440, y: 0, width: 2560, height: 1600 };
    expect(maximizedRect(second, { top: 30, right: 0, bottom: 0, left: 0 })).toEqual({ x: 3440, y: 30, width: 2560, height: 1570 });
  });
});

describe('insetFromProbe', () => {
  const area = { x: 0, y: 0, width: 3440, height: 1440 };

  it('reads the reserved strip a maximized probe leaves behind', () => {
    expect(insetFromProbe({ x: 0, y: 0, width: 3440, height: 1392 }, area)).toEqual({ top: 0, right: 0, bottom: 48, left: 0 });
  });

  it('reports no inset when the probe filled the whole work area', () => {
    expect(insetFromProbe({ x: 0, y: 0, width: 3440, height: 1440 }, area)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  // The bug this exists for: the probe lands on whichever display the window manager chose, and
  // measuring it against another display's work area yields a negative inset that would shove the
  // window off screen. It has to be refused, not applied.
  it('refuses an answer from a different display', () => {
    expect(insetFromProbe({ x: 3440, y: 0, width: 2560, height: 1540 }, area)).toBeNull();
  });

  it('refuses an implausibly large inset', () => {
    expect(insetFromProbe({ x: 0, y: 0, width: 3440, height: 400 }, area)).toBeNull();
    expect(insetFromProbe({ x: 0, y: 0, width: 900, height: 1440 }, area)).toBeNull();
  });
});

describe('resizeBy', () => {
  const start = { x: 500, y: 300, width: 1000, height: 800 };

  it('moves without resizing', () => {
    expect(resizeBy(start, 'move', 40, -25)).toEqual({ x: 540, y: 275, width: 1000, height: 800 });
  });

  // One case per edge and corner: which of the four numbers each one is allowed to touch.
  const cases: Array<[string, ReturnType<typeof resizeBy>]> = [
    ['e', { x: 500, y: 300, width: 1100, height: 800 }],
    ['s', { x: 500, y: 300, width: 1000, height: 900 }],
    ['w', { x: 600, y: 300, width: 900, height: 800 }],
    ['n', { x: 500, y: 400, width: 1000, height: 700 }],
    ['se', { x: 500, y: 300, width: 1100, height: 900 }],
    ['sw', { x: 600, y: 300, width: 900, height: 900 }],
    ['ne', { x: 500, y: 400, width: 1100, height: 700 }],
    ['nw', { x: 600, y: 400, width: 900, height: 700 }],
  ];
  for (const [edge, expected] of cases) {
    it(`drags the ${edge} edge`, () => {
      expect(resizeBy(start, edge as never, 100, 100)).toEqual(expected);
    });
  }

  // The collapse: with no minimum the clamp did nothing, an edge dragged past its opposite took the
  // size to zero, and the origin followed it into the corner of the screen.
  it('stops at the minimum instead of collapsing', () => {
    const crushed = resizeBy(start, 'se', -5000, -5000);
    expect(crushed.width).toBe(MIN_WIDTH);
    expect(crushed.height).toBe(MIN_HEIGHT);
  });

  // Clamping the size alone would let the origin keep travelling after the window stopped shrinking.
  it('pins the origin once a top-left drag hits the minimum', () => {
    const crushed = resizeBy(start, 'nw', 5000, 5000);
    expect(crushed).toEqual({
      x: start.x + start.width - MIN_WIDTH,
      y: start.y + start.height - MIN_HEIGHT,
      width: MIN_WIDTH,
      height: MIN_HEIGHT,
    });
  });

  // Every event in a gesture reports its offset from where the gesture BEGAN and is applied to the
  // rectangle captured then, so replaying the same total lands in the same place however many events
  // arrive. Feeding each result into the next — what per-event deltas would amount to — drifts, and
  // that is the failure this shape avoids.
  it('applies the total offset, so repeated events do not accumulate', () => {
    const once = resizeBy(start, 'e', 30, 0);
    expect(resizeBy(start, 'e', 30, 0)).toEqual(once);
    expect(resizeBy(resizeBy(start, 'e', 10, 0), 'e', 30, 0)).not.toEqual(once);
  });
});

describe('unmaximizeUnderPointer', () => {
  const maximized = { x: 0, y: 0, width: 3440, height: 1392 };
  const restored = { width: 1000, height: 700 };

  it('keeps the cursor at the same relative point across the bar', () => {
    const at = unmaximizeUnderPointer(maximized, restored, { x: 1720, y: 12 });
    expect(at).toEqual({ x: 1220, y: 0, width: 1000, height: 700 });
    // Half way along the maximized window is half way along the restored one.
    expect((1720 - at.x) / at.width).toBeCloseTo(0.5);
  });

  it('keeps a cursor near the left edge near the left edge', () => {
    const at = unmaximizeUnderPointer(maximized, restored, { x: 40, y: 8 });
    expect((40 - at.x) / at.width).toBeCloseTo(40 / 3440, 3);
  });

  it('centres when the maximized width is unknown', () => {
    const at = unmaximizeUnderPointer({ ...maximized, width: 0 }, restored, { x: 800, y: 5 });
    expect(at.x).toBe(300);
  });
});

describe('frameOffsetVerdict', () => {
  it('waits while the reading still matches what was asked for', () => {
    expect(frameOffsetVerdict(0, 0)).toBe('wait');
  });

  it('takes a frame-sized difference', () => {
    expect(frameOffsetVerdict(6, 27)).toBe('correct');
  });

  // The failure this had once: an unmapped window reads about -32700 on both axes for the first
  // ~50ms. Treating that as the answer made it give up before the real offset arrived at ~250ms.
  it('waits through the unmapped reading rather than treating it as an answer', () => {
    expect(frameOffsetVerdict(-32700, -32700)).toBe('wait');
  });
});
