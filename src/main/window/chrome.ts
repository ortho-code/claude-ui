/**
 * Whether the app draws its own window chrome instead of letting the OS do it.
 *
 * CURRENTLY OFF, on the window it was built for.
 * It works — a title bar of our own, our own maximize, a handle on every edge — but dragging the window is visibly steppy and cannot be made smooth: the gesture is ours, every move is a round trip to the compositor, and handing the drag back to the compositor brings a double-click-to-maximize that misdraws and cannot be suppressed.
 * That trade was not worth it in daily use.
 * Why, and why each piece is hand-built, is in docs/architecture/window.md § The window's own chrome.
 *
 * TO TURN IT BACK ON: `process.platform !== 'darwin'`.
 * Everything hangs off this one flag — the frame, the shadow, whether the native maximize is allowed, our maximize, the title bar the renderer draws, the resize handles, and the frame-offset correction that only a DECORATED window needs.
 * Both paths are live: macOS has always run the OS-chrome side of every one of those branches.
 *
 * macOS could never have the frameless side as it stands: `frame: false` there removes the traffic lights and puts nothing in their place, and the mac build is real, published on every version tag.
 * Its variant is `titleBarStyle: 'hiddenInset'`, unbuilt while nobody here can look at a Mac.
 */
export const OWN_CHROME = false as boolean;
