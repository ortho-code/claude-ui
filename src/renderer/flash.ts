import './flash.css';

// A brief accent wash on whatever you just jumped to. Short jumps move the list barely at all, so without it there is no way to tell the click did anything.
export function flash(el: HTMLElement): void {
  el.classList.remove('flash'); // restart it if you jump to the same place twice
  // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- the read is the point, and `void` says it is unused on purpose
  void el.offsetWidth; // force a reflow so removing and re-adding actually replays the animation
  el.classList.add('flash');
  window.setTimeout(() => el.classList.remove('flash'), 900);
}
