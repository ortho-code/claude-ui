import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * The window's computed styles as lines of text, so that two captures compare with `diff`: every element at rest, and every control with `:hover` and `:focus-visible` forced on, as what changed.
 *
 * An element is keyed by its nearest id and the tags and classes below it, so a key survives code moving around as long as the DOM it builds does not change.
 * At rest a property is written only where it differs from the parent's, which loses nothing, since the parent is written the same way down from `body`, and keeps a capture to a few hundred kilobytes.
 * A pseudo-element is written where it has content, as it differs from its element.
 * A forced state is written as what differs from rest, for the control and what is inside it, and for hover the few ancestors a real pointer hovers with it and that a rule here reads (the split button's one outline, a row's pin, a divider's chevron).
 * Forced through the DevTools protocol rather than by moving the mouse, since a real hover runs the page's own handlers — a submenu opening, a tooltip — and those would change what is captured.
 * Transitions are finished and animations held at their start, and transitions are switched off while states are forced, so a value is never read mid-way; `transition-*` itself is therefore left out of the forced states.
 * The lines are written sorted, so an element that a module now builds in another place in the page, looking the same, changes nothing here; whether it still paints the same is the picture's to say.
 */

/** What gets its hover and focus captured: what you press or type into, a divider, whose chevrons brighten on hover, and anything the page gives a pointer — the element that gives it, since `cursor` is inherited by everything inside. */
const CONTROLS = 'button, input, textarea, select, a[href], [role="button"], [role="menuitem"], .divider';
/**
 * How many ancestors are hovered with a control. Every rule here that styles something other than the element hovered reaches from at most two levels up (`.split-button:hover > …`, `.exchange-request:hover .exchange-pin`), and hovering everything up to `body` restyles the whole window for each control.
 * Raise it when a rule reaches further.
 */
const HOVER_UP = 3;
/** A control holding more than this is captured without what is inside it: a forced state on a container changes little inside it, and reading thousands of elements per control would make a capture take minutes. */
const MAX_INSIDE = 200;

interface Installed {
  lines: string[];
  targets: number[];
}

interface Snap {
  elements: Element[];
  keys: string[];
  rest: Record<string, string>[];
  pseudo: Map<string, Record<string, string>>;
  /** Every computed property of an element or one of its pseudo-elements; kept here because a page-side function cannot import one. */
  read: (el: Element, pseudo?: string) => Record<string, string>;
}

declare global {
  interface Window {
    __styleSnap?: Snap;
  }
}

/** Page side: number every element, key it, capture it at rest, and name the controls. Runs in the page, so it is self-contained. */
function install(controls: string): Installed {
  // Sorted, since custom properties come back in a different order from one page load to the next.
  const read = (el: Element, pseudo?: string): Record<string, string> => {
    const style = getComputedStyle(el, pseudo);
    const properties = Array.from({ length: style.length }, (_, i) => style.item(i)).sort();
    return Object.fromEntries(properties.map((property) => [property, style.getPropertyValue(property)]));
  };
  const elements = [document.body, ...document.body.querySelectorAll('*')];
  const indexOf = new Map(elements.map((el, i) => [el, i]));
  const keys: string[] = [];
  const seen = new Map<string, number>();
  elements.forEach((el, i) => {
    el.setAttribute('data-style-snap', String(i));
    if (i === 0) keys.push('body');
    else if (el.id) keys.push(`#${el.id}`);
    else {
      const slot = `${keys[indexOf.get(el.parentElement!)!]} > ${el.tagName.toLowerCase()}${[...el.classList].sort().map((name) => `.${name}`).join('')}`;
      const n = (seen.get(slot) ?? 0) + 1;
      seen.set(slot, n);
      keys.push(n === 1 ? slot : `${slot}:${n}`);
    }
  });
  const rest = elements.map((el) => read(el));
  const pseudo = new Map<string, Record<string, string>>();
  const lines: string[] = [];
  elements.forEach((el, i) => {
    const own = rest[i];
    const parent = i === 0 ? null : rest[indexOf.get(el.parentElement!)!];
    for (const [property, value] of Object.entries(own)) if (parent?.[property] !== value) lines.push(`${keys[i]} | ${property}: ${value}`);
    for (const which of ['::before', '::after']) {
      const style = read(el, which);
      if (style.content === 'none' || style.content === 'normal') continue;
      pseudo.set(`${i}${which}`, style);
      for (const [property, value] of Object.entries(style)) if (own[property] !== value) lines.push(`${keys[i]}${which} | ${property}: ${value}`);
    }
  });
  window.__styleSnap = { elements, keys, rest, pseudo, read };
  const gives = (el: Element, i: number): boolean => rest[i].cursor === 'pointer' && (i === 0 || rest[indexOf.get(el.parentElement!)!].cursor !== 'pointer');
  const targets = elements.flatMap((el, i) => (el.matches(controls) || gives(el, i) ? [i] : []));
  return { lines, targets };
}

/** Page side: what differs from rest now that a state is forced on `target` (and, for hover, on its ancestors). */
function changed({ target, state, maxInside, hoverUp }: { target: number; state: 'hover' | 'focus'; maxInside: number; hoverUp: number }): string[] {
  const snap = window.__styleSnap!;
  const read = snap.read;
  const el = snap.elements[target];
  const inside = [el, ...el.querySelectorAll('*')];
  const own = inside.length > maxInside ? [el] : inside;
  const above: Element[] = [];
  if (state === 'hover') for (let up = el.parentElement; up && up !== document.documentElement && above.length < hoverUp; up = up.parentElement) above.unshift(up);
  const lines: string[] = [];
  for (const node of [...above, ...own]) {
    const i = Number(node.getAttribute('data-style-snap'));
    // Made since the capture at rest: nothing to compare it with, and nothing a forced state makes.
    if (Number.isNaN(i)) continue;
    const prefix = `${state} ${snap.keys[target]} :: ${snap.keys[i]}`;
    const now = read(node);
    for (const [property, value] of Object.entries(now)) if (!property.startsWith('transition') && snap.rest[i][property] !== value) lines.push(`${prefix} | ${property}: ${value}`);
    for (const which of ['::before', '::after']) {
      const style = read(node, which);
      const was = snap.pseudo.get(`${i}${which}`);
      if (!was && (style.content === 'none' || style.content === 'normal')) continue;
      for (const [property, value] of Object.entries(style)) if (!property.startsWith('transition') && was?.[property] !== value) lines.push(`${prefix}${which} | ${property}: ${value}`);
    }
  }
  return lines;
}

interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
}

/**
 * Capture the window as it stands into `<dir>/<name>.txt`, and a picture of it into `<dir>/<name>.png`.
 * The picture is for what computed styles cannot show: which of two overlapping elements paints on top, which follows from their order in the page as much as from any style. Two pictures of one build are the same bytes but for one known two-pixel exception, which compare.ts lists like any other difference.
 */
export async function snapshot(page: Page, dir: string, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // A jump's flash takes itself off 0.9 s after it starts (flash.ts), on a timer the hold below cannot pause, so a capture that caught it would depend on how fast it ran: it is a passing wash, not a look to keep, so it ends first.
  await page.waitForFunction(() => document.querySelector('.flash') === null);
  // Let a history drawn in slices, and anything else the last step set off, finish.
  await page.waitForTimeout(300);
  // A tooltip shows 400 ms after the pointer comes to rest on its target and hides on the next move, so a slow run can show and hide one between two steps, leaving behind a hidden #tooltip (tooltip.ts makes it on first show, and keeps its last position) that a fast run never made.
  // A hidden one draws nothing, so it goes; a shown one is a look to keep, and a state of its own holds one up.
  await page.evaluate(() => {
    const tip = document.getElementById('tooltip');
    if (tip?.hidden) tip.remove();
  });
  const hold = (): Promise<void> =>
    page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        if (animation instanceof CSSTransition) animation.finish();
        else {
          animation.pause();
          animation.currentTime = 0;
        }
      }
    });
  await hold();
  await mkdir(dir, { recursive: true });
  // At rest, before anything is numbered or forced. Playwright plays an endless animation again once the picture is taken, so it is held again after.
  await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' });
  await hold();
  const { lines: rest, targets } = await page.evaluate(install, CONTROLS);
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = (await cdp.send('DOM.getDocument', { depth: -1 })) as { root: DomNode };
  const nodeOf = new Map<number, number>();
  const walk = (node: DomNode): void => {
    const at = node.attributes?.indexOf('data-style-snap') ?? -1;
    if (at >= 0) nodeOf.set(Number(node.attributes![at + 1]), node.nodeId);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  const parents = await page.evaluate(() => window.__styleSnap!.elements.map((el) => Number(el.parentElement?.getAttribute('data-style-snap') ?? -1)));
  const force = async (indices: number[], classes: string[]): Promise<void> => {
    await Promise.all(indices.map((i) => cdp.send('CSS.forcePseudoState', { nodeId: nodeOf.get(i)!, forcedPseudoClasses: classes })));
  };

  const forced: string[] = [];
  for (const target of targets) {
    const chain = [target];
    while (chain.length <= HOVER_UP && parents[chain[0]] >= 0) chain.unshift(parents[chain[0]]);
    await force(chain, ['hover']);
    forced.push(...(await page.evaluate(changed, { target, state: 'hover' as const, maxInside: MAX_INSIDE, hoverUp: HOVER_UP })));
    await force(chain, []);
    await force([target], ['focus', 'focus-visible']);
    forced.push(...(await page.evaluate(changed, { target, state: 'focus' as const, maxInside: MAX_INSIDE, hoverUp: HOVER_UP })));
    await force([target], []);
  }
  await cdp.detach();

  await writeFile(path.join(dir, `${name}.txt`), `${[...rest.sort(), ...forced.sort()].join('\n')}\n`);
}
