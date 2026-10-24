import { badgeClass } from './statusdot';
import { closeIcon } from './svg';
import './notifications.css';

// Stacking attention toasts: a background tab (one you're not viewing) went waiting/idle, or its claude has not left a stop.
// Separate from the one-off #toast message bar (toast.ts).
document.body.insertAdjacentHTML('beforeend', '<div id="notifications"></div>');
const notifications = document.getElementById('notifications')!;
const NOTIF_TTL = 5000;
const NOTIF_MAX = 4;

/** What an attention toast says, and where a click on it goes; the caller decides both, since it is the one that knows the session. */
export interface Attention {
  status: 'waiting' | 'idle';
  label: string;
  project: string;
  /** Why it is up, under the project, where the status alone does not say it; its line breaks kept. */
  detail?: string;
  open: () => void;
}

/**
 * Put an attention toast up, newest on top; it goes after a while unless the pointer is on it.
 * `sticky` keeps it until it is dismissed, clicked, or taken down by the function this answers, and newer toasts do not push it out, for a state that lasts until something ends it: a stop claude has not left, where a toast gone in seconds is the very thing that gets missed.
 */
export function showAttentionToast({ status, label, project, detail, open }: Attention, sticky = false): () => void {
  const el = document.createElement('div');
  el.className = `notif ${status}`;
  const dot = document.createElement('span');
  dot.className = badgeClass(status);
  // The dot/edge colour already says waiting vs finished; the text names the tab and its project.
  const text = document.createElement('span');
  text.className = 'notif-text';
  const title = document.createElement('span');
  title.className = 'notif-title';
  title.textContent = label;
  const proj = document.createElement('span');
  proj.className = 'notif-proj';
  proj.textContent = project;
  text.append(title, proj);
  if (detail) {
    const why = document.createElement('span');
    why.className = 'notif-detail';
    why.textContent = detail;
    text.append(why);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn notif-close';
  close.innerHTML = closeIcon(14);
  close.setAttribute('aria-label', 'Dismiss');
  el.append(dot, text, close);

  let timer: number | undefined;
  const dismiss = (): void => {
    window.clearTimeout(timer);
    el.remove();
  };
  const arm = (): void => {
    if (!sticky) timer = window.setTimeout(dismiss, NOTIF_TTL);
  };
  el.addEventListener('mouseenter', () => window.clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', () => {
    dismiss();
    open();
  });
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    dismiss();
  });

  el.classList.toggle('sticky', sticky);
  notifications.prepend(el); // newest on top
  // Past the cap the oldest goes, unless it stays: those go only when they are taken down, so only a stack of them all can lose one.
  while (notifications.childElementCount > NOTIF_MAX) {
    const oldestFirst = [...notifications.children].reverse();
    (oldestFirst.find((toast) => !toast.classList.contains('sticky')) ?? oldestFirst[0])?.remove();
  }
  arm();
  return dismiss;
}
