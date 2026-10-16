/**
 * Whether the app is quitting, as the window hears it from main before main ends every terminal.
 * From then on what the quit itself causes, every terminal exiting, is not kept as if you had done it: a surface that keeps what it holds for the next launch stops writing.
 */

let quitting = false;

window.claudeUi.onQuitting(() => {
  quitting = true;
});

export const isQuitting = (): boolean => quitting;
