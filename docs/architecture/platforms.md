# Platforms

## Environment

The app runs on Linux and macOS, the two systems a version tag builds for, and on Windows inside WSL 2, as a Linux app whose window WSLg shows.
The Electron app, the `claude` CLI it launches and the `~/.claude` session store are always on one system, so no path is translated between systems: under WSL that system is the Linux distribution, never Windows.

On Linux the app starts with `--no-sandbox`, passed by the `start` script and the packaged launcher (`electron-builder.yml`), since it cannot be set from inside the app (`src/main/main.ts`); WSL is where it was found to be needed.
The packaged macOS app keeps its sandbox.

### Under WSL

It runs on **X11 (Xwayland)**, the Electron default there.
Do not switch it to Wayland: with `--ozone-platform=wayland` the window paints solid white, with or without `app.disableHardwareAcceleration()`, while a bare Electron window with the same flags paints fine — so it is something about this window, and it has not been chased down.
`--ozone-platform-hint=auto` picks X11 anyway.

If **every cursor stays an arrow** — no hand over a button, no I-beam over an input — that is WSLg's pointer state stuck, not the app and not Xwayland.
Nothing in CSS or in Chromium's flags will move it (verified: every control computes `cursor: pointer` correctly).
Closing all WSLg windows and reopening clears it; so does starting and quitting any Wayland client, which cycles Weston's pointer.
