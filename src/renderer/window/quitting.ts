/**
 * Whether the app is quitting, as the window hears it from main before main ends every terminal.
 * From then on what the quit itself causes, every terminal exiting, is not kept as if you had done it: a surface that keeps what it holds for the next launch stops writing.
 */

let quitting = false;
const lastWrites: (() => void)[] = [];

window.claudeUi.onQuitting(() => {
  quitting = true;
  for (const write of lastWrites) write();
});

export const isQuitting = (): boolean => quitting;

/** Run `write` once the app is quitting, after `isQuitting` turns true: a surface's last word for the next launch on what the quit is about to end. */
export function whenQuitting(write: () => void): void {
  lastWrites.push(write);
}
