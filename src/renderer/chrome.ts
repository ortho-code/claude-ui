import { closeIcon, strokeIcon } from './svg';
import { setTooltip } from './tooltip';
import './chrome.css';

// ---- The window's own title bar ----
// Drawn only where there is no OS one. Every piece of it starts hidden, so macOS — which keeps its native frame and traffic lights — simply never turns any of it on.
// Why each piece is hand-built, the native maximize among them, is in docs/architecture.md § The window's own chrome.

// Our title bar, first in the page so it sits above the app. A strip of its own rather than controls folded into the row below, which was tried first: with the tab bar wrapping to two rows there was almost no empty space left to grab, so the window became hard to move.
// The top three resize handles live INSIDE the bar, positioned against it (chrome.css), and the bar's own drag leaves them to resize (onBarBackground); the other five are outside, below.
// They went inside for a drag region the bar no longer has, which ignored any handle that was not its descendant.
document.body.insertAdjacentHTML(
  'afterbegin',
  `<div id="titlebar" hidden>
    <div class="resize-edge" data-edge="nw"></div>
    <div class="resize-edge" data-edge="n"></div>
    <div class="resize-edge" data-edge="ne"></div>
    <img id="app-mark" src="./icon.png" alt="" width="16" height="16" />
    <span id="window-title"></span>
    <div id="window-controls">
      <button id="win-minimize" type="button" data-tooltip="Minimize" aria-label="Minimize"></button>
      <button id="win-maximize" type="button" data-tooltip="Maximize" aria-label="Maximize"></button>
      <button id="win-close" type="button" class="danger" data-tooltip="Close" aria-label="Close"></button>
    </div>
  </div>`,
);
// The remaining edges and corners. Fixed to the window, above everything, and only shown where we draw the chrome.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="resize-edges" hidden>
    <div class="resize-edge" data-edge="w"></div>
    <div class="resize-edge" data-edge="e"></div>
    <div class="resize-edge" data-edge="s"></div>
    <div class="resize-edge" data-edge="sw"></div>
    <div class="resize-edge" data-edge="se"></div>
  </div>`,
);

// The window controls, drawn from the same set as everything else rather than as the platform glyphs they imitate — the app has no font-glyph icons anywhere and these should not be the exception.
const minimizeIcon = (size: number): string => strokeIcon(size, '<path d="M3.5 8H12.5" />');
const maximizeIcon = (size: number): string => strokeIcon(size, '<rect x="3.9" y="3.9" width="8.2" height="8.2" rx="1.4" />');
// Restore reads as "there is another window behind this one": the same square, with a second one peeking out top-right.
const restoreIcon = (size: number): string =>
  strokeIcon(size, '<path d="M5.6 5.6V4.4a1 1 0 011-1h4.8a1 1 0 011 1v4.8a1 1 0 01-1 1h-1.2" /><rect x="3.4" y="5.6" width="7" height="7" rx="1.2" />');

const resizeEdges = document.getElementById('resize-edges')!;
const titlebar = document.getElementById('titlebar')!;
const windowVersion = document.getElementById('window-title')!;
const winMinimize = document.getElementById('win-minimize') as HTMLButtonElement;
const winMaximize = document.getElementById('win-maximize') as HTMLButtonElement;
const winClose = document.getElementById('win-close') as HTMLButtonElement;
let windowMaximized = false;

function paintMaximizeButton(): void {
  const label = windowMaximized ? 'Restore' : 'Maximize';
  winMaximize.innerHTML = windowMaximized ? restoreIcon(14) : maximizeIcon(14);
  winMaximize.setAttribute('aria-label', label);
  setTooltip(winMaximize, label);
}

/** Ask main whether the app draws its own chrome, and if it does, show and wire the title bar and the edges. */
export async function startChrome(): Promise<void> {
  const chrome = await window.claudeUi.getWindowChrome();
  if (!chrome.own) return;
  // The strip lives inside the bar, so unhiding the bar reveals both.
  titlebar.hidden = false;

  // The version, and whether this is a run from source, lost their home when the OS title bar went.
  windowVersion.textContent = chrome.title;
  setTooltip(windowVersion, chrome.title);

  windowMaximized = chrome.maximized;
  paintMaximizeButton();
  winMinimize.innerHTML = minimizeIcon(14);
  winClose.innerHTML = closeIcon(14);

  winMinimize.addEventListener('click', () => window.claudeUi.minimizeWindow());
  winMaximize.addEventListener('click', () => window.claudeUi.toggleMaximizeWindow());
  winClose.addEventListener('click', () => window.claudeUi.closeWindow());
  // Also fires when a window manager maximized the window and the main process converted that into ours.
  window.claudeUi.onWindowMaximized((value) => {
    windowMaximized = value;
    paintMaximizeButton();
  });
  // What counts as "the bar" for dragging and double-clicking: the strip and its inert contents (the mark, the title), but not the controls and not the resize handles along its top. Testing `event.target === titlebar` instead was a real bug: the title fills the middle of the bar (flex: 1), so a double-click on the header almost always lands on IT, and the toggle never ran — the window maximized natively instead, drawn offset and with the app unaware it had happened.
  const onBarBackground = (event: Event): boolean => {
    const target = event.target as HTMLElement | null;
    return target !== null && !target.closest('#window-controls') && !target.closest('.resize-edge');
  };

  titlebar.addEventListener('dblclick', (event) => {
    if (onBarBackground(event)) window.claudeUi.toggleMaximizeWindow();
  });

  // One gesture for moving and for resizing every edge: same pointer capture, same slack, same frame-throttled reporting, differing only in which edge the main process is told to work on. They were two near-identical blocks; see CLAUDE.md on one implementation per behaviour.
  //
  // screenX/screenY throughout, never client coordinates: the window itself moves under the gesture, so anything measured relative to it shifts beneath a pointer that has not moved. The offset sent is the TOTAL from where the gesture began, which the main process applies to the bounds it captured then — incremental deltas would each be measured against the previous move's result and drift.
  //
  // Nothing starts until the pointer has actually travelled: on the title bar the first thing a drag does is come out of maximize, so starting on pointerdown made a plain CLICK restore the window.
  const GESTURE_SLACK = 4;

  function wireWindowGesture(handle: HTMLElement, edge: string, accepts: (event: PointerEvent) => boolean): void {
    handle.addEventListener('pointerdown', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const downX = event.screenX;
      const downY = event.screenY;
      let originX = downX;
      let originY = downY;
      let started = false;
      // One setBounds per frame at most. A pointermove can fire far more often than the compositor can place a window, and the backlog is what made a drag stutter between positions before catching up at the end.
      let pending: { dx: number; dy: number } | null = null;
      let frame = 0;
      const flush = (): void => {
        frame = 0;
        if (!pending) return;
        window.claudeUi.resizeWindowBy(pending.dx, pending.dy);
        pending = null;
      };
      const move = (moved: PointerEvent): void => {
        if (!started) {
          if (Math.abs(moved.screenX - downX) < GESTURE_SLACK && Math.abs(moved.screenY - downY) < GESTURE_SLACK) return;
          started = true;
          // Measure from HERE, not from the pointerdown: coming out of maximize repositions the window under the cursor, so the bounds the main process captures belong to this moment.
          originX = moved.screenX;
          originY = moved.screenY;
          window.claudeUi.startWindowResize(edge, { x: moved.screenX, y: moved.screenY });
          return;
        }
        pending = { dx: moved.screenX - originX, dy: moved.screenY - originY };
        if (!frame) frame = requestAnimationFrame(flush);
      };
      const up = (ended: PointerEvent): void => {
        handle.releasePointerCapture(ended.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        if (!started) return;
        // The last move may still be queued for the next frame, and dropping it would leave the window a few pixels from where the gesture ended.
        if (frame) cancelAnimationFrame(frame);
        flush();
        window.claudeUi.endWindowResize();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  wireWindowGesture(titlebar, 'move', onBarBackground);
  resizeEdges.hidden = false;
  // Every edge and corner is ours: Chromium offers a 4px margin on three sides and none at the top, so a hand-built top edge alone would have behaved unlike its neighbours.
  for (const handle of document.querySelectorAll<HTMLElement>('.resize-edge')) {
    wireWindowGesture(handle, handle.dataset.edge ?? '', () => !windowMaximized);
  }
}
