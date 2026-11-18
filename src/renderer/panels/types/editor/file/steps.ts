import { element } from '../../../../ui/dom';
import './steps.css';

/**
 * Where the diff's stepper is, and the change map beside the diff: one tick per change block, placed where the block lands in the drawn diff, so a long file shows its shape before it is scrolled.
 * The ticks are read off the laid-out rows, because the folds decide where a block ends up and only the layout knows.
 */

/** The smallest a tick is drawn, so a one-line change stays something to press. */
const MIN_TICK_PX = 3;

/** Mark change `cursor` as the one the stepper is on, and scroll the diff, not the page, to put it in the middle. */
export function markCursor(body: HTMLElement, anchors: readonly HTMLElement[], cursor: number): void {
  for (const line of body.querySelectorAll('.diff-line.current')) line.classList.remove('current');
  const anchor = anchors[cursor];
  if (!anchor) return;
  anchor.classList.add('current');
  body.scrollTop = Math.max(0, anchor.offsetTop - body.clientHeight / 2);
}

/** Draw the map's ticks for the blocks of `body`, the current one marked, each a press that goes to its block. */
export function drawMap(map: HTMLElement, body: HTMLElement, blocks: number, cursor: number, go: (block: number) => void): void {
  map.replaceChildren();
  const total = body.scrollHeight;
  map.hidden = blocks === 0 || total === 0;
  if (map.hidden) return;
  const spans = new Map<number, { top: number; bottom: number; add: boolean; del: boolean }>();
  for (const row of body.querySelectorAll<HTMLElement>('[data-blk]')) {
    const block = Number(row.dataset.blk);
    const span = spans.get(block) ?? { top: Infinity, bottom: -Infinity, add: false, del: false };
    span.top = Math.min(span.top, row.offsetTop);
    span.bottom = Math.max(span.bottom, row.offsetTop + row.offsetHeight);
    span.add ||= row.classList.contains('add');
    span.del ||= row.classList.contains('del');
    spans.set(block, span);
  }
  for (let block = 0; block < blocks; block++) {
    const span = spans.get(block);
    if (!span) continue;
    const tick = element('button', `diff-tick ${span.add && span.del ? 'mixed' : span.add ? 'add' : 'del'}${block === cursor ? ' current' : ''}`);
    tick.type = 'button';
    tick.style.top = `${(span.top / total) * 100}%`;
    tick.style.height = `${Math.max(MIN_TICK_PX, ((span.bottom - span.top) / total) * map.clientHeight)}px`;
    tick.title = `Change ${block + 1} of ${blocks}`;
    tick.setAttribute('aria-label', tick.title);
    tick.addEventListener('click', () => go(block));
    map.append(tick);
  }
}
