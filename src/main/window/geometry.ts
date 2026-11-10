import { BrowserWindow, ipcMain, screen } from 'electron';
import { errorText, log } from '../logs/log';
import { setWindowBounds } from '../sessions/meta';
import { maximizedRect, insetFromProbe, resizeBy, unmaximizeUnderPointer, frameOffsetVerdict, NO_INSET } from './bounds';
import type { Edge, Inset } from './bounds';
import { OWN_CHROME } from './chrome';

/** The app's window, or null while it has none; set by `registerGeometry`. */
let windowOf: () => BrowserWindow | null = () => null;

/**
 * Persist the window's geometry as it changes.
 *
 * Debounced because `resize` and `move` fire continuously while a window is being dragged, and every write here is a full read-modify-write of meta.json plus an audit line; one write per gesture is what is wanted, not one per frame.
 * The `close` handler flushes rather than schedules, since the last resize before quitting is exactly the one worth keeping and there is no later tick to run it in.
 *
 * The rectangle saved is the UNMAXIMIZED one, or a maximized window would be stored as its own screen-sized self and there would be nothing to go back to.
 * `getNormalBounds` is what supplies that while the OS owns maximizing; where we own it the window is never natively maximized, so that call would return the maximized rectangle and `normalBounds` is the answer instead.
 */
export function trackBounds(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  // Undebounced, unlike the save: this has to see the size the user dragged to BEFORE a maximize replaces it, and a debounce could let the maximize land first.
  const remember = (): void => {
    // `isMaximized` as well as our own flag: a native maximize fires this event before the handler that converts it into ours, and the window already reports the maximized rectangle by then.
    if (win.isDestroyed() || maximized || win.isMaximized()) return;
    normalBounds = win.getBounds();
  };
  const save = (): void => {
    if (win.isDestroyed()) return;
    const { x, y, width, height } = OWN_CHROME ? (normalBounds ?? win.getBounds()) : win.getNormalBounds();
    void setWindowBounds({ x, y, width, height, maximized: OWN_CHROME ? maximized : win.isMaximized() });
  };
  const schedule = (): void => {
    remember();
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      save();
    }, 400);
  };
  // One per line rather than a loop over the names: BrowserWindow.on is overloaded per event, so a union of event names does not type-check.
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

/**
 * How long to wait for the frame to appear before giving up on there being one.
 * Measured at ~250ms here, with a trivial window and with the real one alike, so this is eight times the margin it needs.
 */
const FRAME_DEADLINE_MS = 2000;

/**
 * Cancel the frame offset this window manager adds to every position it is given.
 *
 * ONLY REACHED WHEN THE WINDOW IS DECORATED (`!OWN_CHROME`), because the offset is a property of the DECORATION and a frameless window lands exactly where it asks.
 * It is kept, rather than deleted with the frame, so that turning our own chrome off is genuinely one flag: without it the native path would quietly bring back the per-launch drift this was written to fix.
 *
 * Measured under WSLg: asking for 300,200 — at creation, through setPosition, or through setBounds alike — lands the window at 306,227, and that is also what reading the bounds back reports.
 * So storing the position on close and asking for it again on launch walks the window down and to the right by one title bar every single time.
 * Since the same offset applies to a request as to a reading, asking for `wanted - offset` lands exactly on `wanted`.
 *
 * POLLED rather than driven by an event, and that is the whole subtlety: the first `move` fires while the bounds still read back exactly what was asked for, and the frame only appears some 40ms later.
 * Correcting on `move` would therefore measure an offset of zero and quietly leave the drift in place — which is the failure this is here to prevent, so it must not be the failure it ships with.
 * On a window manager that adds no offset, nothing ever differs, the deadline passes, and no correction is made.
 */
export function correctFramePlacement(win: BrowserWindow, wanted: { x: number; y: number }): void {
  const started = Date.now();
  const tick = (): void => {
    // Nothing to correct on a maximized window, and nothing to correct on one that has gone away.
    if (win.isDestroyed() || win.isMaximized()) return;
    const { x, y } = win.getBounds();
    const dx = x - wanted.x;
    const dy = y - wanted.y;
    // A frame-sized difference is the offset this exists to cancel.
    // Take it and stop.
    if (frameOffsetVerdict(dx, dy) === 'correct') {
      win.setPosition(wanted.x - dx, wanted.y - dy);
      return;
    }
    // Everything else means "not settled yet", and MUST keep polling rather than conclude anything.
    // Two readings arrive before the real one: the position we asked for, unchanged, and — for the first ~50ms, while the window is not yet mapped — the far off-screen coordinates X11 parks it at, measured here as about -32700 on both axes.
    // Treating either as an answer is what made an earlier version of this give up at 54ms and never see the offset that arrived at ~250ms.
    if (Date.now() - started < FRAME_DEADLINE_MS) setTimeout(tick, 25);
  };
  setTimeout(tick, 25);
}

/**
 * Our own maximize, because the native one cannot be used on a frameless window here.
 *
 * `maximize()` and `setFullScreen()` both MISDRAW a frameless window under WSLg: the invisible resize margin a frameless window still carries is applied to the pixels but not to the input region, so a control is painted in one place and clicked in another, and anything near the right edge is pushed off-screen while remaining clickable at the true edge.
 * `setBounds` to the work area has neither problem — bounds and content agree, and it lands where it says.
 * So the window never enters the native maximized state at all, and the flag is ours.
 * Why is in docs/architecture/window.md § The window's own chrome; this is not a preference and should not be "simplified" back to `maximize()`.
 *
 * The frame offset this file used to cancel by polling (the window manager adding its title bar to every position it was given) went with the frame: it was a property of the decoration, and a frameless window lands exactly where it asks.
 */
let maximized = false;
/**
 * How much smaller than its display's work area a maximized window should be.
 *
 * `screen`'s work area is the WHOLE display here — WSLg publishes no `_NET_WORKAREA` for anything to read — so maximizing to it covers the Windows taskbar.
 * The window manager itself knows the right rectangle and will say so when asked to maximize something, so we ask once, with a window that is never shown: `{ show: false, frame: false }` maximizes and reports `3440x1392` against a `3440x1440` work area, correct within 100ms and with nothing on screen.
 * Kept as an INSET rather than a rectangle so it still means something on a second display, whose work area is its own.
 */
const maximizeInsets = new Map<number, Inset>();
let probing = false;

/** Whether the window is maximized by our own maximize (`setMaximized`). */
export function isOwnMaximized(): boolean {
  return maximized;
}

/**
 * Ask the window manager what a maximized window measures, using a window nobody ever sees.
 *
 * WHICH DISPLAY THE ANSWER IS ABOUT CANNOT BE CHOSEN, so it is recorded per display and learned again when a display turns up that we have no answer for.
 * Measured: a probe positioned onto the second display with `setBounds` — which does move it — still maximizes onto the first, and in a run where another window was being built at the same time it maximized onto the second instead.
 * There is no way to ask the question OF a display; only to see which one answered.
 * Hence the map and the re-probe, rather than a single value: one shot at startup is a coin flip, and losing it silently leaves a maximized window over the taskbar for the whole session.
 */
export function learnMaximizeInset(): void {
  if (!OWN_CHROME || probing) return;
  let probe: BrowserWindow;
  try {
    probing = true;
    probe = new BrowserWindow({
      show: false,
      frame: false,
      width: 400,
      height: 300,
      skipTaskbar: true,
      // A PLAIN window, deliberately, and this is the trap: `show: false` does not stop a maximized window being mapped, so it paints — but every way of making it not paint also stops it maximizing, which is the one thing it exists to do.
      // Measured, each in its own process: plain maximizes; `opacity: 0`, `transparent: true`, `backgroundColor: '#00000000'` and `focusable: false` each leave it at its original size.
      // An earlier version set opacity and transparency to kill the white flash and thereby stopped learning the inset at all, which put maximized windows back over the taskbar — with no error, because the nonsense measurement was correctly rejected.
      // So the flash stays, in the app's own colour rather than white.
      backgroundColor: '#1e1e2e',
    });
    probe.maximize();
  } catch (error) {
    // The work area stays the answer; a taskbar-covering maximize beats no window.
    log('warn', 'window', `maximize probe not created, maximizing to the work area: ${errorText(error)}`);
    probing = false;
    return;
  }
  setTimeout(() => {
    try {
      const got = probe.getBounds();
      // The display it LANDED on, not the primary: computing against the wrong one yields a negative inset, which is how this silently did nothing the first time.
      const display = screen.getDisplayMatching(got);
      const inset = insetFromProbe(got, display.workArea);
      if (inset) {
        maximizeInsets.set(display.id, inset);
        // A window maximized before this answer existed is sitting over whatever the inset avoids — the launch path restores a maximized window well before the probe replies.
        // Re-apply now.
        const mainWindow = windowOf();
        if (mainWindow && !mainWindow.isDestroyed() && maximized) mainWindow.setBounds(maximizedTarget(mainWindow));
      }
    } catch (error) {
      log('warn', 'window', `maximize probe not read, keeping the work area: ${errorText(error)}`);
    }
    if (!probe.isDestroyed()) probe.destroy();
    probing = false;
  }, 250);
}
/**
 * Where an un-maximize goes back to.
 *
 * Kept continuously rather than captured at the moment of maximizing, because by the time a NATIVE maximize event reaches us the window already reports the maximized rectangle, leaving nothing to restore.
 */
let normalBounds: Electron.Rectangle | null = null;

/** The rectangle a maximized window should fill on whichever display it is on. */
function maximizedTarget(win: BrowserWindow): Electron.Rectangle {
  const display = screen.getDisplayMatching(win.getBounds());
  // An inset measured on one display means nothing on another, so an unknown display gets none — and asks for one, which corrects this window a moment later if it turns out to need it.
  const known = maximizeInsets.get(display.id);
  if (!known) learnMaximizeInset();
  return maximizedRect(display.workArea, known ?? NO_INSET);
}

export function setMaximized(win: BrowserWindow, on: boolean): void {
  // On macOS the window still has its frame, so the OS owns this and does it correctly.
  if (!OWN_CHROME) {
    if (on) win.maximize();
    else win.unmaximize();
    return;
  }
  if (on === maximized || win.isDestroyed()) return;
  if (on && !normalBounds) normalBounds = win.getBounds();
  const target = on ? maximizedTarget(win) : normalBounds;
  // Set the flag BEFORE moving: the resize this causes must not be mistaken for the user resizing, which would overwrite the very rectangle being kept to go back to.
  maximized = on;
  if (target) win.setBounds(target);
  win.webContents.send('window:maximized', maximized);
}

/**
 * Resizing, all four edges and the corners, driven by the renderer.
 *
 * Chromium gives a frameless window an invisible resize margin of its own, but only 4px and only on three sides — the top has none at all, so that edge could not be resized without this.
 * Rather than have one edge behave differently from the other three, every edge is ours: uniform, and a comfortable target instead of 4px.
 *
 * The gesture sends its TOTAL offset from where it started, against the bounds captured at pointerdown, rather than a delta per move.
 * Deltas accumulate rounding, and worse, each one would be measured against a window that the previous one just moved.
 */
let resizeFrom: { edge: Edge; bounds: Electron.Rectangle } | null = null;

/** The window's maximize, and its resizing and moving by the renderer, on `window`, the app's window or null while it has none. */
export function registerGeometry(window: () => BrowserWindow | null): void {
  windowOf = window;
  ipcMain.on('window:toggleMaximize', () => {
    const mainWindow = windowOf();
    if (mainWindow) setMaximized(mainWindow, !maximized);
  });
  ipcMain.on('window:resizeStart', (_event, edge: Edge, pointer?: { x: number; y: number }) => {
    const mainWindow = windowOf();
    if (!mainWindow || !OWN_CHROME) return;
    // Dragging a maximized window restores it and keeps dragging, the way a real title bar does.
    // Resizing one is refused instead — there is no size to resize FROM.
    if (maximized) {
      if (edge !== 'move' || !pointer) return;
      const from = mainWindow.getBounds();
      const restored = normalBounds ?? { ...from, width: Math.round(from.width / 2), height: Math.round(from.height / 2) };
      // Put the window back under the cursor rather than back where it last was.
      // Restoring to its old position left the pointer somewhere else entirely, so the window jumped away and the drag carried on from a place the cursor was not.
      // The cursor keeps its position ACROSS the bar proportionally, and its exact offset DOWN it, which is what every other title bar does.
      maximized = false;
      const target = unmaximizeUnderPointer(from, restored, pointer);
      mainWindow.setBounds(target);
      mainWindow.webContents.send('window:maximized', false);
      // The rectangle we ASKED for, not one read back: `getBounds` right after `setBounds` still reports the old geometry here (the same lag the startup placement had to poll around), so reading it would base the whole drag on the MAXIMIZED rectangle and throw the window across the screen until a later frame corrected it.
      // That is the stutter, at its worst.
      resizeFrom = { edge, bounds: target };
      return;
    }
    resizeFrom = { edge, bounds: mainWindow.getBounds() };
  });
  ipcMain.on('window:resizeEnd', () => {
    resizeFrom = null;
  });
  ipcMain.on('window:resizeBy', (_event, dx: number, dy: number) => {
    const mainWindow = windowOf();
    if (!mainWindow || !resizeFrom) return;
    const { edge, bounds } = resizeFrom;
    const next = resizeBy(bounds, edge, dx, dy);
    if (edge === 'move') {
      const at = mainWindow.getPosition();
      if (at[0] === next.x && at[1] === next.y) return; // nothing to ask for; every call is a round trip to the compositor
      // setPosition rather than setBounds: a move that also states a size makes the window manager renegotiate the size on every frame of a drag, and it is the size negotiation that lags.
      mainWindow.setPosition(next.x, next.y);
      return;
    }
    mainWindow.setBounds(next);
  });
}
