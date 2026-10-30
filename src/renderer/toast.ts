import { closeIcon } from './svg';
import './toast.css';

/** The one-off message bar at the foot of the window, built here once, where the page's own markup used to hold it. */
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="toast" hidden>
    <span id="toast-message"></span>
    <button id="toast-action" type="button" hidden></button>
    <button id="toast-close" class="icon-btn" type="button" data-tooltip="Dismiss" aria-label="Dismiss"></button>
  </div>`,
);
const toast = document.getElementById('toast')!;
const toastMessage = document.getElementById('toast-message')!;
const toastAction = document.getElementById('toast-action') as HTMLButtonElement;
const toastClose = document.getElementById('toast-close') as HTMLButtonElement;

/** How long a toast stays: a message is read in 3 s, and one with a button has to be read and then reached for, so it stays 8 s, and while the pointer is on it (decided 2026-10-28). */
const TOAST_MS = 3000;
const ACTION_TOAST_MS = 8000;

/** A button on a toast, such as Undo: its words, and what a press does, after which the toast goes. */
export interface ToastAction {
  label: string;
  run: () => void;
}

let toastTimer: number | undefined;
/** The action of the toast up, null for none, so its button presses the one it shows. */
let shownAction: ToastAction | null = null;
/** How long the toast up stays once the pointer leaves it, or null for one that stays until dismissed. */
let shownFor: number | null = null;

function hideAfter(ms: number | null): void {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = ms === null ? undefined : window.setTimeout(() => hideToast(), ms);
}

/**
 * Take the toast down; given a message, only while that message is the one up, so a condition that clears takes down its own toast and never one that has replaced it since.
 */
export function hideToast(message?: string): void {
  if (message !== undefined && (toast.hidden || toastMessage.textContent !== message)) return;
  toast.hidden = true;
  shownAction = null;
  if (toastTimer) clearTimeout(toastTimer);
}
/**
 * `sticky` keeps the message up until it is dismissed, for a condition that will not resolve on its own — a missing `claude` CLI is the case it exists for, where three seconds would be gone before the sentence was read.
 * `action` puts a button on it, such as Undo, and keeps it up longer; a newer toast replaces it, button and all, since the bar holds one.
 */
export function showToast(message: string, sticky = false, action: ToastAction | null = null): void {
  toastMessage.textContent = message;
  shownAction = action;
  toastAction.hidden = action === null;
  toastAction.textContent = action?.label ?? '';
  toast.hidden = false;
  shownFor = sticky ? null : action ? ACTION_TOAST_MS : TOAST_MS;
  // One with a button that comes up under the pointer is held at once, since no pointer entering it will say so.
  hideAfter(action && toast.matches(':hover') ? null : shownFor);
}

/** Copy to the clipboard with a small confirmation toast, since the OS gives no visible cue otherwise: one behaviour for every copy in the app, in each caller's own words. */
export async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch {
    showToast("Couldn't copy to the clipboard.");
  }
}

toastClose.innerHTML = closeIcon(14);
toastClose.addEventListener('click', () => hideToast());
toastAction.addEventListener('click', () => {
  const action = shownAction;
  hideToast();
  action?.run();
});
// Held while the pointer is on a toast with a button, which is reaching for it, and its full time again once the pointer leaves.
toast.addEventListener('mouseenter', () => {
  if (shownAction) hideAfter(null);
});
toast.addEventListener('mouseleave', () => {
  if (shownAction && !toast.hidden) hideAfter(shownFor);
});
