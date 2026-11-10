import { app, BrowserWindow, ipcMain, nativeImage, screen } from 'electron';
import type { NativeImage } from 'electron';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { errorText, log } from '../logs/log';
import { watchWindow } from '../logs/diagnostics';
import { settingsNow } from '../config/settings';
import { getWindowBounds } from '../sessions/meta';
import { placeWindow, MIN_WIDTH, MIN_HEIGHT } from './bounds';
import { OWN_CHROME } from './chrome';
import { correctFramePlacement, isOwnMaximized, setMaximized, trackBounds } from './geometry';
import { rendererArguments } from './rendererargs';

let mainWindow: BrowserWindow | null = null;

/** The app's window, or null while it has none. */
export function currentWindow(): BrowserWindow | null {
  return mainWindow;
}

/**
 * Window title, and the app's only always-visible version stamp.
 * See createWindow.
 * The dev suffix matters because the two are otherwise identical: same name, same version, same icon, and the same data directory, so there is nothing on screen to say whether you are looking at the installed app or one started from source.
 * `app.isPackaged` is derived rather than configured, so it cannot drift.
 */
const appTitle = `Claude UI ${app.getVersion()}${app.isPackaged ? '' : ' — dev'}`;

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
    const png = readFileSync(path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'));
    return nativeImage.createFromBuffer(png).resize({ width: 256, height: 256, quality: 'best' });
  } catch (error) {
    // A default icon is a far better outcome than no window, but a build without its icon is a packaging mistake worth finding.
    log('warn', 'window', `icon not loaded: ${errorText(error)}`);
    return undefined;
  }
}

export async function createWindow(): Promise<void> {
  // Reading this before the window exists is the point: bounds have to be constructor arguments, since assigning them afterwards makes the window visibly jump from the default position to the stored one.
  const placement = placeWindow(
    await getWindowBounds(),
    screen.getAllDisplays().map((d) => d.workArea),
  );
  // Read afresh for each window, so one opened again on macOS starts in a language changed since.
  const { locale } = await settingsNow();
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
    // The renderer draws the title bar wherever this is frameless.
    // macOS keeps its own — see OWN_CHROME.
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
      preload: path.join(__dirname, '..', '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: rendererArguments(locale),
    },
  });

  // After construction, unlike the size: maximizing is a state change rather than a geometry argument, and doing it here leaves the constructed rectangle as the size to return to.
  if (placement?.maximized) setMaximized(mainWindow, true);
  // A decorated window is placed at its requested position PLUS the frame, so a restored position walks down-right on every launch unless it is cancelled.
  // Only the decorated path needs it, which today is macOS — and whatever OWN_CHROME is turned off for tomorrow.
  else if (!OWN_CHROME && placement?.x !== undefined && placement.y !== undefined) {
    correctFramePlacement(mainWindow, { x: placement.x, y: placement.y });
  }
  trackBounds(mainWindow);
  watchWindow(mainWindow);
  // Nothing may take this window anywhere else, or open another: a page loaded here would get the preload's bridge, and the bridge runs commands.
  // Every link the window opens leaves through `shell:openExternal` instead.
  // The app never navigates on purpose, and `loadFile` below is programmatic, which this event does not see.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault();
    log('warn', 'window', 'refused a navigation away from the app');
  });
  mainWindow.webContents.setWindowOpenHandler(() => {
    log('warn', 'window', 'refused to open a new window');
    return { action: 'deny' };
  });

  void mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
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

/** The title bar the renderer draws, and the controls the OS bar used to provide. */
export function registerWindowIpc(): void {
  // `window:chrome` is asked once at startup: the renderer draws its bar only where there is no OS one, and the answer cannot change while the app runs.
  ipcMain.handle('window:chrome', () => ({
    own: OWN_CHROME,
    maximized: isOwnMaximized(),
    title: appTitle,
    version: app.getVersion(),
    dev: !app.isPackaged,
  }));
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:close', () => mainWindow?.close());
}
