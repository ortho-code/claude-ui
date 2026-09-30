import { closeIcon } from './svg';
import './toast.css';

/** The one-off message bar at the foot of the window, built here once, where the page's own markup used to hold it. */
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="toast" hidden>
    <span id="toast-message"></span>
    <button id="toast-close" class="icon-btn" type="button" data-tooltip="Dismiss" aria-label="Dismiss"></button>
  </div>`,
);
const toast = document.getElementById('toast')!;
const toastMessage = document.getElementById('toast-message')!;
const toastClose = document.getElementById('toast-close') as HTMLButtonElement;

let toastTimer: number | undefined;
export function hideToast(): void {
  toast.hidden = true;
  if (toastTimer) clearTimeout(toastTimer);
}
/**
 * `sticky` keeps the message up until it is dismissed, for a condition that will not resolve on its own — a missing `claude` CLI is the case it exists for, where three seconds would be gone before the sentence was read.
 */
export function showToast(message: string, sticky = false): void {
  toastMessage.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = sticky ? undefined : window.setTimeout(hideToast, 3000);
}
toastClose.innerHTML = closeIcon(14);
toastClose.addEventListener('click', hideToast);
