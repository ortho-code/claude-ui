import { describe, it, expect } from 'vitest';
import { placeWindow } from './bounds';

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
