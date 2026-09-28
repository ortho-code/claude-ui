// Custom tooltip: one floating element shown on hover/keyboard-focus of any [data-tooltip].
// Replaces native title= — those have an OS-dependent delay and look, and can't be styled or hold richer content (e.g. a full path).
// Delegated from the document so it covers dynamically added rows/tabs without per-element wiring.

const SHOW_DELAY = 400; // ms before a hovered tooltip appears.
const GAP = 8; // px between the target and the tooltip.

let tip: HTMLDivElement | null = null;
let showTimer: number | undefined;
let currentTarget: HTMLElement | null = null;

function ensureTip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
  }
  return tip;
}

// Prefer below the target; flip above if it would overflow the bottom. Center on the target horizontally, clamped into the viewport.
function position(el: HTMLDivElement, target: HTMLElement): void {
  const r = target.getBoundingClientRect();
  const tw = el.offsetWidth;
  const th = el.offsetHeight;
  let top = r.bottom + GAP;
  if (top + th > window.innerHeight - GAP) top = r.top - GAP - th;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(GAP, Math.min(left, window.innerWidth - GAP - tw));
  el.style.top = `${Math.max(GAP, top)}px`;
  el.style.left = `${left}px`;
}

function show(target: HTMLElement): void {
  const text = target.getAttribute('data-tooltip');
  if (!text) return;
  const el = ensureTip();
  el.textContent = text;
  el.hidden = false;
  position(el, target);
}

function hide(): void {
  window.clearTimeout(showTimer);
  currentTarget = null;
  if (tip) tip.hidden = true;
}

function scheduleShow(target: HTMLElement): void {
  window.clearTimeout(showTimer);
  currentTarget = target;
  showTimer = window.setTimeout(() => {
    if (currentTarget === target && target.isConnected) show(target);
  }, SHOW_DELAY);
}

function tooltipTarget(node: EventTarget | null): HTMLElement | null {
  return node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null;
}

export function installTooltips(): void {
  document.addEventListener('mouseover', (event) => {
    const target = tooltipTarget(event.target);
    if (target && target !== currentTarget) scheduleShow(target);
  });
  document.addEventListener('mouseout', (event) => {
    const target = tooltipTarget(event.target);
    if (!target) return;
    // Moving within the same target's children is not a leave.
    const to = event.relatedTarget;
    if (to instanceof Node && target.contains(to)) return;
    hide();
  });
  // Keyboard focus shows the tooltip; a mouse click that focuses does not (:focus-visible).
  document.addEventListener('focusin', (event) => {
    const target = tooltipTarget(event.target);
    if (target?.matches(':focus-visible')) scheduleShow(target);
  });
  document.addEventListener('focusout', hide);
  // A click acts on the element, so the hint has served its purpose; scrolling moves the anchor.
  document.addEventListener('click', hide, true);
  window.addEventListener('scroll', hide, true);
}

// Set or clear an element's tooltip. Empty/undefined removes the attribute so it never shows a blank tip and closest() can fall through to a tooltipped ancestor.
export function setTooltip(el: HTMLElement, text: string | null | undefined): void {
  if (text) el.setAttribute('data-tooltip', text);
  else el.removeAttribute('data-tooltip');
}
