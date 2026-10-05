// First, and for its side effect: paths.ts pins the userData directory, and must run before any module computes a path from it.
// See the comment there.
import './paths';
import { app, BrowserWindow, ipcMain, Menu, dialog, shell, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { findTranscript, listSessions, trashSessions, worktreeExists } from './sessions';
import { readHistory } from './transcript';
import { registerTerminalIpc, terminateAll } from './terminal';
import { registerConfig } from './config';
import { registerFolders } from './folders';
import { registerPanelsIpc, stopAllPanels } from './panels';
import { forgetSessions, registerPanelData } from './paneldata';
import { logsDir } from './paths';
import { startLog, closeLog, errorText, log } from './log';
import { headerLines, logGpuStatus, logProcessFailures, registerRendererLog, watchWindow } from './diagnostics';
import { localTimestamp } from './stamp';
import {
  getPinned,
  togglePin,
  getHistoryPins,
  toggleHistoryPin,
  getArchived,
  toggleArchive,
  getOpenSessions,
  setOpenSessions,
  getActiveSession,
  getActiveSessionByProject,
  setActiveSession,
  getActiveProject,
  setActiveProject,
  getProjectNames,
  getNotes,
  setNote,
  setProjectName,
  recordClear,
  getGroupState,
  createGroup,
  renameGroup,
  deleteGroup,
  moveSessionToGroup,
  moveGroup,
  getProjectOrder,
  seedProjectOrder,
  moveProject,
  migrateToSessionKeys,
  purgeSession,
  getWindowBounds,
  setWindowBounds,
  getUiState,
  setUiState,
  getSettings,
  setSettings,
} from './meta';
import {
  placeWindow,
  maximizedRect,
  insetFromProbe,
  resizeBy,
  unmaximizeUnderPointer,
  frameOffsetVerdict,
  MIN_WIDTH,
  MIN_HEIGHT,
  NO_INSET,
} from './bounds';
import type { Edge, Inset } from './bounds';
import { installStatusHooks, registerStatusIpc, clearStatuses } from './status';
import { registerSessionsWatcher } from './watcher';
import { NO_TRANSCRIPT } from '../shared/history';
import type { HistoryPin, HistorySlice, OrderMove, UiState, Settings } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

/**
 * Window title, and the app's only always-visible version stamp.
 * See createWindow.
 * The dev suffix matters because the two are otherwise identical: same name, same version, same icon, and the same data directory, so there is nothing on screen to say whether you are looking at the installed app or one started from source.
 * `app.isPackaged` is derived rather than configured, so it cannot drift.
 */
const appTitle = `Claude UI ${app.getVersion()}${app.isPackaged ? '' : ' — dev'}`;

/**
 * Whether the app draws its own window chrome instead of letting the OS do it.
 *
 * CURRENTLY OFF, on the window it was built for.
 * It works — a title bar of our own, our own maximize, a handle on every edge — but dragging the window is visibly steppy and cannot be made smooth: the gesture is ours, every move is a round trip to the compositor, and handing the drag back to the compositor brings a double-click-to-maximize that misdraws and cannot be suppressed.
 * That trade was not worth it in daily use.
 * Why, and why each piece is hand-built, is in docs/architecture.md § The window's own chrome.
 *
 * TO TURN IT BACK ON: `process.platform !== 'darwin'`.
 * Everything hangs off this one flag — the frame, the shadow, whether the native maximize is allowed, our maximize, the title bar the renderer draws, the resize handles, and the frame-offset correction that only a DECORATED window needs.
 * Both paths are live: macOS has always run the OS-chrome side of every one of those branches.
 *
 * macOS could never have the frameless side as it stands: `frame: false` there removes the traffic lights and puts nothing in their place, and the mac build is real, published on every version tag.
 * Its variant is `titleBarStyle: 'hiddenInset'`, unbuilt while nobody here can look at a Mac.
 */
const OWN_CHROME = false as boolean;

// `--no-sandbox` cannot be set from inside the app.
// Do NOT try `app.commandLine.appendSwitch('no-sandbox')`: it was tried and reverted, because it runs too late for the renderer, which then dies with a FATAL about /dev/shm permissions (misleading — /dev/shm is fine) and leaves an empty window painted in the background colour.
// Measured both ways with a throwaway XDG_CONFIG_HOME: argv flag clean, appendSwitch fatal.
// The switch has to be on the command line before Electron starts, so it belongs to whatever launches the app — the `start` script in development, and the packaged launcher's own arguments once there is one.

// The app stays on X11 (Xwayland) under WSLg.
// Do NOT add --ozone-platform=wayland: it paints this window solid white, with or without app.disableHardwareAcceleration().
// Both were tried and reverted.
// See docs/architecture.md, including the note on an all-arrow cursor, which looks like an X11 limitation but is WSLg's pointer state stuck.

// Only one claude-ui instance at a time; a second launch focuses the existing window.
// This may change if we add pop-out / multi-window sessions later.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const launched = localTimestamp();
  startLog({ dir: logsDir, header: () => headerLines(launched) });
  logProcessFailures();
  registerRendererLog();
  logGpuStatus();
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

/**
 * The application menu, which is a platform decision rather than a preference.
 *
 * On Linux there is none, so the default File/Edit/View items — reload, dev tools, view source — stay out of a UI that drives everything itself.
 *
 * macOS cannot afford that.
 * There, Cmd+C/V/X/A/Z are delivered by menu ROLES, not by the focused web contents, so a null menu silently costs copy and paste everywhere, the terminal included.
 * This is the smallest menu that keeps them: the app menu macOS expects (About, Hide, Quit), the edit roles, and the window roles.
 * Nothing custom, so nothing to keep in sync.
 */
function installAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}

/**
 * Is the `claude` CLI actually installed?
 * Asked through a login+interactive shell for the same reason terminal.ts spawns one: on this kind of setup `claude` arrives on PATH via mise/asdf/direnv activation in the shell rc, which a non-interactive shell skips entirely.
 *
 * This has never been false on the development machine, which is exactly why it needs asking: an install without the CLI would otherwise open every tab on "command not found", which reads as this app being broken rather than as a missing prerequisite.
 */
function claudeIsInstalled(): Promise<boolean> {
  const shell = process.env.SHELL ?? '/bin/bash';
  return new Promise((resolve) => {
    execFile(shell, ['-l', '-i', '-c', 'command -v claude'], { timeout: 15_000 }, (error, stdout) => {
      resolve(!error && stdout.trim().length > 0);
    });
  });
}

/**
 * The window icon, read as BYTES rather than handed over as a path.
 *
 * `BrowserWindow`'s `icon` option is consumed by native code, which does not go through Electron's asar-aware fs layer.
 * Once packaged, `…/resources/app.asar/assets/icon.png` is therefore a path that does not exist on disk: the icon silently fails to load, X11 gets no `_NET_WM_ICON`, and the window shows the desktop's generic fallback instead.
 * It only appears when packaged, because in development `assets/` is a real directory.
 * Node's `fs` does read inside the asar, so loading the bytes here behaves identically both ways with nothing to unpack.
 *
 * Resized down from the 1024px source that macOS needs: this one is drawn at taskbar size, and Electron's own filtering beats leaving a window manager to crush 1024px into 32.
 */
function windowIcon(): NativeImage | undefined {
  try {
    const png = readFileSync(path.join(__dirname, '..', '..', 'assets', 'icon.png'));
    return nativeImage.createFromBuffer(png).resize({ width: 256, height: 256, quality: 'best' });
  } catch (error) {
    // A default icon is a far better outcome than no window, but a build without its icon is a packaging mistake worth finding.
    log('warn', 'window', `icon not loaded: ${errorText(error)}`);
    return undefined;
  }
}

/**
 * Persist the window's geometry as it changes.
 *
 * Debounced because `resize` and `move` fire continuously while a window is being dragged, and every write here is a full read-modify-write of meta.json plus an audit line; one write per gesture is what is wanted, not one per frame.
 * The `close` handler flushes rather than schedules, since the last resize before quitting is exactly the one worth keeping and there is no later tick to run it in.
 *
 * The rectangle saved is the UNMAXIMIZED one, or a maximized window would be stored as its own screen-sized self and there would be nothing to go back to.
 * `getNormalBounds` is what supplies that while the OS owns maximizing; where we own it the window is never natively maximized, so that call would return the maximized rectangle and `normalBounds` is the answer instead.
 */
function trackBounds(win: BrowserWindow): void {
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
function correctFramePlacement(win: BrowserWindow, wanted: { x: number; y: number }): void {
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
 * Why is in docs/architecture.md § The window's own chrome; this is not a preference and should not be "simplified" back to `maximize()`.
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

/**
 * Ask the window manager what a maximized window measures, using a window nobody ever sees.
 *
 * WHICH DISPLAY THE ANSWER IS ABOUT CANNOT BE CHOSEN, so it is recorded per display and learned again when a display turns up that we have no answer for.
 * Measured: a probe positioned onto the second display with `setBounds` — which does move it — still maximizes onto the first, and in a run where another window was being built at the same time it maximized onto the second instead.
 * There is no way to ask the question OF a display; only to see which one answered.
 * Hence the map and the re-probe, rather than a single value: one shot at startup is a coin flip, and losing it silently leaves a maximized window over the taskbar for the whole session.
 */
function learnMaximizeInset(): void {
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

function setMaximized(win: BrowserWindow, on: boolean): void {
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

async function createWindow(): Promise<void> {
  // Reading this before the window exists is the point: bounds have to be constructor arguments, since assigning them afterwards makes the window visibly jump from the default position to the stored one.
  const placement = placeWindow(
    await getWindowBounds(),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  mainWindow = new BrowserWindow({
    width: placement?.width ?? 1100,
    height: placement?.height ?? 760,
    // Undefined leaves placement to the platform, which is what we want both on a first run and when the stored position is no longer on any screen.
    x: placement?.x,
    y: placement?.y,
    // The floor the resize handles clamp against, via getMinimumSize.
    // Without it that clamp reads [0, 0] and does nothing: dragging an edge past its opposite collapsed the window to nothing and left it in the screen corner, recoverable only because placeWindow repairs the stored size on the next launch.
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: appTitle,
    icon: windowIcon(),
    // The renderer draws the title bar wherever this is frameless. macOS keeps its own — see OWN_CHROME.
    frame: !OWN_CHROME,
    // NOT cosmetic, and not about the border down the side of the window — that one is weston's 32px frame and nothing here touches it.
    // Chromium's shadow is what reserves the small margin that shows up as `getBounds` disagreeing with `getContentBounds`, and with the window sized to fill the screen that margin insets the PAINT while the input region keeps the full rectangle: the controls are then drawn in one place and clickable in another.
    // Removed once on the mistaken grounds that it "did nothing", which was judged against the border it was never fixing; the mismatch came straight back.
    // Leave it off.
    hasShadow: !OWN_CHROME,
    // Refuse the NATIVE maximize outright rather than undoing it after the fact.
    // Intercepting it — unmaximize, then apply ours — deadlocked the window on a double-click: the window manager and the app each kept answering the other, and it came back only after some seconds.
    // With this the double-click has no native meaning, and the renderer's own handler is the only path.
    maximizable: !OWN_CHROME,
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // After construction, unlike the size: maximizing is a state change rather than a geometry argument, and doing it here leaves the constructed rectangle as the size to return to.
  if (placement?.maximized) setMaximized(mainWindow, true);
  // A decorated window is placed at its requested position PLUS the frame, so a restored position
  // walks down-right on every launch unless it is cancelled. Only the decorated path needs it, which
  // today is macOS — and whatever OWN_CHROME is turned off for tomorrow.
  else if (!OWN_CHROME && placement?.x !== undefined && placement.y !== undefined) {
    correctFramePlacement(mainWindow, { x: placement.x, y: placement.y });
  }
  trackBounds(mainWindow);
  watchWindow(mainWindow);
  // Nothing may take this window anywhere else, or open another: a page loaded here would get the preload's bridge, and the bridge runs commands.
  // Links leave through `shell:openExternal` instead — the terminal's and the history's.
  // The app never navigates on purpose, and `loadFile` below is programmatic, which this event does not see.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
    log('warn', 'window', 'refused a navigation away from the app');
  });
  mainWindow.webContents.setWindowOpenHandler(() => {
    log('warn', 'window', 'refused to open a new window');
    return { action: 'deny' };
  });

  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.webContents.on('did-finish-load', () => {
    // index.html carries its own <title>, which wins over the BrowserWindow option, so set it here instead.
    // Without auto-update the version has to be visible somewhere, and the title bar is where someone asked "which version are you on?" will actually look.
    mainWindow?.setTitle(appTitle);
    void claudeIsInstalled().then((installed) => {
      if (installed || !mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.webContents.send('app:claude-missing');
    });
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('sessions:list', () => listSessions());
ipcMain.handle('history:get', async (_event, id: string, known: number, generation: number): Promise<HistorySlice> => {
  const file = await findTranscript(id);
  // No transcript yet is a session nothing has been sent in: an empty history, not an error.
  if (!file) return NO_TRANSCRIPT;
  return readHistory(file, Number.isInteger(known) && known > 0 ? known : 0, Number.isInteger(generation) ? generation : 0);
});
ipcMain.handle('meta:recordClear', (_event, from: string, to: string, title: string) => recordClear(from, to, title));
ipcMain.handle('sessions:worktreeExists', (_event, repoRoot: string, name: string) => worktreeExists(repoRoot, name));
ipcMain.handle('meta:getPinned', () => getPinned());
ipcMain.handle('meta:togglePin', (_event, id: string) => togglePin(id));
ipcMain.handle('meta:getHistoryPins', () => getHistoryPins());
ipcMain.handle('meta:toggleHistoryPin', (_event, id: string, pin: Pick<HistoryPin, 'kind' | 'session' | 'text' | 'time'>) => toggleHistoryPin(id, pin));
ipcMain.on('shell:openExternal', (_event, url: string) => {
  // Only ever hand the OS http(s) links from terminal output — never file://, etc.
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
});
ipcMain.handle('meta:getArchived', () => getArchived());
ipcMain.handle('meta:toggleArchive', (_event, id: string) => toggleArchive(id));
ipcMain.handle('sessions:delete', async (_event, id: string) => {
  // The renderer confirms via its own modal (a native dialog flickers under WSLg), so here we just do the deletion: move the files to trash, then drop the session from metadata.
  await trashSessions([id]);
  await purgeSession(id);
  await clearStatuses([id]);
  // A row that started it would otherwise lead back to a session that is gone.
  await forgetSessions([id]);
});
ipcMain.handle('dialog:pickFolder', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle('meta:getOpenSessions', () => getOpenSessions());
ipcMain.handle('meta:getActiveSession', () => getActiveSession());
ipcMain.handle('meta:getActiveSessionByProject', () => getActiveSessionByProject());
ipcMain.on('meta:setActiveSession', (_event, id: string | null, repoRoot?: string) => {
  void setActiveSession(id, repoRoot);
});
ipcMain.on('meta:setOpenSessions', (_event, ids: string[]) => {
  void setOpenSessions(ids);
});
ipcMain.handle('meta:getActiveProject', () => getActiveProject());
ipcMain.on('meta:setActiveProject', (_event, folder: string | null) => {
  void setActiveProject(folder);
});
ipcMain.handle('meta:getNotes', () => getNotes());
ipcMain.handle('meta:setNote', (_event, id: string, note: string) => setNote(id, note));
ipcMain.handle('meta:getUiState', () => getUiState());
ipcMain.on('meta:setUiState', (_event, state: UiState) => {
  void setUiState(state);
});
ipcMain.handle('meta:getSettings', () => getSettings());
// Unlike setUiState this is an invoke, not a send: the write can be refused (see setSettings), and the renderer is entitled to see what was actually stored.
ipcMain.handle('meta:setSettings', (_event, settings: Settings) => setSettings(settings));
// The title bar the renderer draws needs the controls the OS bar used to provide.
// `window:chrome` is asked once at startup: the renderer draws its bar only where there is no OS one, and the answer cannot change while the app runs.
ipcMain.handle('window:chrome', () => ({
  own: OWN_CHROME,
  maximized,
  title: appTitle,
  version: app.getVersion(),
  dev: !app.isPackaged,
}));
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggleMaximize', () => {
  if (mainWindow) setMaximized(mainWindow, !maximized);
});
ipcMain.on('window:close', () => mainWindow?.close());
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

ipcMain.on('window:resizeStart', (_event, edge: Edge, pointer?: { x: number; y: number }) => {
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

ipcMain.handle('meta:getProjectNames', () => getProjectNames());
ipcMain.handle('meta:setProjectName', (_event, repoRoot: string, name: string) => setProjectName(repoRoot, name));
ipcMain.handle('meta:getGroupState', () => getGroupState());
ipcMain.handle('meta:createGroup', (_event, name: string, repoRoot: string | null, sessionId?: string) =>
  createGroup(name, repoRoot, sessionId),
);
ipcMain.handle('meta:renameGroup', (_event, id: string, name: string) => renameGroup(id, name));
ipcMain.handle('meta:deleteGroup', (_event, id: string) => deleteGroup(id));
ipcMain.handle('meta:moveGroup', (_event, id: string, move: OrderMove) => moveGroup(id, move));
ipcMain.handle('meta:getProjectOrder', () => getProjectOrder());
ipcMain.handle('meta:seedProjectOrder', (_event, roots: string[]) => seedProjectOrder(roots));
ipcMain.handle('meta:moveProject', (_event, repoRoot: string, move: OrderMove) => moveProject(repoRoot, move));
ipcMain.handle('meta:moveSessionToGroup', (_event, sessionId: string, groupId: string | null) =>
  moveSessionToGroup(sessionId, groupId),
);
registerTerminalIpc();
registerPanelsIpc();

void app.whenReady().then(async () => {
  installAppMenu();
  // Feeds the macOS About item, which the app menu above provides for free.
  app.setAboutPanelOptions({ applicationName: 'Claude UI', applicationVersion: app.getVersion() });
  // One-time: rewrite pins/open-tabs/archived stored under conversation keys to stable session ids.
  // First-wins over the recency-sorted list, so a family's conversationId maps to its latest member.
  const sessions = await listSessions();
  const conversationToId = new Map<string, string>();
  for (const s of sessions) if (!conversationToId.has(s.conversationId)) conversationToId.set(s.conversationId, s.id);
  await migrateToSessionKeys(conversationToId);
  await installStatusHooks();
  registerStatusIpc(() => mainWindow);
  registerSessionsWatcher(() => mainWindow);
  registerConfig(() => mainWindow);
  // A session exists while a tab holds it (one that has sent nothing yet has no transcript), or while its transcript is on disk: looked at, not taken from the listing's cache, which can still name a file Claude Code's retention has since removed.
  registerPanelData(
    () => mainWindow,
    async (ids) => {
      const open = new Set(await getOpenSessions());
      const found = await Promise.all(
        ids.map(async (id) => {
          if (open.has(id)) return true;
          const file = await findTranscript(id);
          return file !== null && existsSync(file);
        }),
      );
      return new Set(ids.filter((_, index) => found[index]));
    },
  );
  registerFolders();
  // Before the window, so the answer is in hand by the time anyone can reach the maximize button.
  learnMaximizeInset();
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Give claude a moment to flush before the app exits.
let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  // Tell the renderer we're shutting down before killing terminals, so the tab-close it triggers for each dying pty doesn't persist an empty open-tabs list over the real one.
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:quitting');
  terminateAll();
  stopAllPanels();
  // The quit line goes last, once everything else has had its budget, because it is what tells the next launch this one ended on purpose.
  setTimeout(() => void closeLog().then(() => app.quit()), 1500);
});
