import { badgeClass } from './statusdot';
import { closeIcon } from './svg';
import './notifications.css';

// Stacking attention toasts: a background tab (one you're not viewing) went waiting/idle.
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
  open: () => void;
}

export function showAttentionToast({ status, label, project, open }: Attention): void {
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
    timer = window.setTimeout(dismiss, NOTIF_TTL);
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

  notifications.prepend(el); // newest on top
  while (notifications.childElementCount > NOTIF_MAX) notifications.lastElementChild?.remove();
  arm();
}
