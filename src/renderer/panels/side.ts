import type { LayoutReport } from '../../shared/panels';
import type { PanelState } from '../../shared/types';
import { installResizer } from '../resizer';
import { setTooltip } from '../tooltip';
import { resolveLayout, type PanelSlot } from './layout';
import { commandType, type MountedPanel, type PanelHost, type PanelType, type Where } from './types/command';

/**
 * The right side: one group holding one panel, beside the terminal.
 *
 * Built from main's report of the layout file and rebuilt whenever that file changes; hidden — divider included — whenever it holds nothing to show, so a window without a layout is the window as it was.
 * This module draws the chrome (the header row, the busy mark, the run's last word, Refresh, the resizer) and hands the body to the entry's TYPE, which owns what happens inside it.
 * The plain-DOM one-group side is deliberate: the file already has the tree shape, so nothing on disk changes when groups and docking arrive; only this module does.
 */

const TYPES: Record<string, PanelType> = { command: commandType };

export const SIDE_MIN = 200;
export const SIDE_MAX = 960;

/** What the side needs from the renderer: where a panel would run, the toast, and the view-state write. */
export interface SideHost {
  where(): Where;
  showToast(message: string, sticky?: boolean): void;
  hideToast(): void;
  persist(): void;
}

const REFRESH_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.49" stroke-linecap="round" stroke-linejoin="round"><path d="M12.8 8.6A4.8 4.8 0 1 1 11.6 4.5" /><path d="M12.9 2.8v2.6h-2.6" /></svg>';

let host: SideHost;
let side: HTMLElement;
let handle: HTMLElement;
let report: LayoutReport | null = null;
/** The width the user dragged to, in px; null while the file's proportion or the stylesheet decides. Restored before the first render, so it is applied by it. */
let draggedWidth: number | null = null;
let mounted: MountedPanel | null = null;
/** Whether the toast up right now is this module's, so a good read can take it down without touching anybody else's. */
let toasted = false;

/** The config folder, for the settings dialog; null until the first report has arrived. */
export function configRoot(): string | null {
  return report?.configRoot ?? null;
}

export function sideState(): PanelState {
  return { width: draggedWidth };
}

export function setSideWidth(width: number | null): void {
  draggedWidth = width;
}

/** The tab or project changed: let the shown panel decide whether that moved its context. */
export function sideContextChanged(): void {
  mounted?.contextChanged();
}

export async function initSide(sideHost: SideHost): Promise<void> {
  host = sideHost;
  side = document.getElementById('side-right')!;
  handle = document.getElementById('side-right-resizer')!;
  installResizer(handle, {
    target: side,
    axis: 'x',
    min: SIDE_MIN,
    max: SIDE_MAX,
    onEnd: (width) => {
      draggedWidth = width;
      host.persist();
    },
  });
  window.claudeUi.onLayoutChanged((next) => render(next));
  render(await window.claudeUi.getLayout());
}

function render(next: LayoutReport): void {
  // Kept whatever the read found: the folder's path is right in every report, and the settings dialog asks for it.
  report = next;
  const view = resolveLayout(next, TYPES);
  // A file that does not parse keeps the last good layout up: the message names the file and the parser's position, and stays until the next read that succeeds, because the condition does not clear on its own.
  if (view.kind === 'unparsable') {
    host.showToast(`${fileName(view.file)}: ${view.message}`, true);
    toasted = true;
    return;
  }
  if (toasted) {
    host.hideToast();
    toasted = false;
  }
  mounted?.unmount();
  mounted = null;
  side.replaceChildren();
  if (view.kind === 'empty') {
    side.hidden = true;
    handle.hidden = true;
    return;
  }
  side.hidden = false;
  handle.hidden = false;
  applyWidth(view.kind === 'panel' ? view.sideSize : null);
  if (view.kind === 'degraded') {
    side.appendChild(group(fileName(next.file), [], problems(view.problems), []));
    return;
  }
  const { slot, notShown } = view;
  if (slot.problems.length > 0) {
    side.appendChild(group(slot.title, [], problems(slot.problems), notShown));
    return;
  }
  side.appendChild(panelGroup(slot, TYPES[slot.type!], notShown));
}

/** The dragged width wins; the file's proportion is read only while there is none; with neither the stylesheet decides. */
function applyWidth(proportion: number | null): void {
  const width = draggedWidth ?? (proportion !== null ? Math.round(document.body.clientWidth * proportion) : null);
  side.style.flexBasis = width !== null ? `${Math.min(SIDE_MAX, Math.max(SIDE_MIN, width))}px` : '';
}

/** A group around a live panel: the type's body under a header carrying the busy mark, the run's last word, and Refresh. */
function panelGroup(slot: PanelSlot, type: PanelType, notShown: string[]): HTMLElement {
  const busy = element('span', 'nudge busy');
  busy.hidden = true;
  const end = element('span', 'panel-end');
  const refresh = element('button', 'icon-btn');
  refresh.setAttribute('type', 'button');
  refresh.setAttribute('aria-label', 'Refresh');
  setTooltip(refresh, 'Refresh');
  refresh.innerHTML = REFRESH_ICON;
  const panelHost: PanelHost = {
    where: () => host.where(),
    setBusy: (on) => {
      busy.hidden = !on;
    },
    setEnd: (label) => {
      end.textContent = label;
    },
  };
  // Mounting starts the first run, which reports through the marks above — so they exist first and are placed after.
  const panel = type.mount(slot, panelHost);
  mounted = panel;
  refresh.addEventListener('click', () => panel.refresh());
  return group(slot.title, [busy, end, refresh], panel.el, notShown);
}

function group(title: string, controls: HTMLElement[], body: HTMLElement, notShown: string[]): HTMLElement {
  const section = element('section', 'panel-group');
  const header = element('div', 'panel-header');
  const heading = element('span', 'panel-title');
  heading.textContent = title;
  setTooltip(heading, title);
  header.append(heading, ...controls);
  section.append(header, body);
  if (notShown.length > 0) {
    const note = element('div', 'panel-note');
    note.textContent = notShown.join(' ');
    section.appendChild(note);
  }
  return section;
}

/** A panel that cannot run says why, one sentence per line, where its output would be. */
function problems(list: string[]): HTMLElement {
  const box = element('div', 'panel-problems');
  for (const problem of list) {
    const line = element('p');
    line.textContent = problem;
    box.appendChild(line);
  }
  return box;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}
