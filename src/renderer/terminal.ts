import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { errorText } from '../shared/log';

/**
 * The xterm every terminal in the window is built from — a tab's `claude` and a panel's shell — and the one place their output and exits are routed.
 * One construction rather than two, because the options here are decisions (the font tokens, the neutral foreground, the canvas fallback, clickable links) that would otherwise be made twice and drift.
 */

// The terminal's face comes from the stylesheet's tokens, so a panel showing command output is set in the same type without a second copy of the values.
const rootStyle = getComputedStyle(document.documentElement);
const MONO_FAMILY = rootStyle.getPropertyValue('--font-mono').trim();
const MONO_SIZE = parseInt(rootStyle.getPropertyValue('--text-mono'), 10);
// Its colours as well, so the history, which is drawn in them, cannot drift from what the terminal shows.
const TERMINAL_BG = rootStyle.getPropertyValue('--terminal-bg').trim();
const TERMINAL_FG = rootStyle.getPropertyValue('--terminal-fg').trim();

export interface TerminalView {
  term: Terminal;
  fitAddon: FitAddon;
}

let canvasLogged = false;

/**
 * The last `count` non-empty lines of a terminal, trimmed, oldest first: what a failed start said, for the log.
 * Read from the buffer as parsed so far, so a caller that has just written waits for `term.write('', …)` first.
 */
export function lastLines(term: Terminal, count: number): string[] {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = buffer.length - 1; i >= 0 && lines.length < count; i--) {
    const text = buffer.getLine(i)?.translateToString(true).trim();
    if (text) lines.unshift(text);
  }
  return lines;
}

/** An xterm opened in `container`, sized to it by the fit addon, drawn on canvas where that works, with http(s) links clickable. */
export function createTerminal(container: HTMLElement): TerminalView {
  const term = new Terminal({
    fontFamily: MONO_FAMILY,
    fontSize: MONO_SIZE,
    // A neutral (hue-less) foreground, and why, are with the token (--terminal-fg in base.css).
    // The select-menu contrast bug (28a); proper per-user terminal colours are item 28.
    theme: { background: TERMINAL_BG, foreground: TERMINAL_FG },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  // Canvas renderer for smoother scrolling/paste than the default DOM renderer; fall back to DOM if it can't initialize (e.g. a WSLg GPU quirk) so the terminal always works.
  // Which one a terminal got is logged, because "the terminal is slow" cannot be answered without it: canvas once, since it is the usual answer, and every fallback, since each is news.
  try {
    term.loadAddon(new CanvasAddon());
    if (!canvasLogged) {
      canvasLogged = true;
      window.claudeUi.log('info', 'xterm', 'terminals draw on canvas');
    }
  } catch (error) {
    // DOM renderer stays in place.
    window.claudeUi.log('warn', 'xterm', `canvas renderer failed, this terminal draws with the DOM renderer instead: ${errorText(error)}`);
  }

  // Make http(s) URLs clickable; open them in the OS browser via the main process.
  term.loadAddon(new WebLinksAddon((_event, uri) => window.claudeUi.openExternal(uri)));

  return { term, fitAddon };
}

/** Where a terminal's output and exit go: a tab's handlers, or a panel's. */
export interface TerminalSink {
  data(data: string): void;
  exit(exitCode: number): void;
}

const sinks = new Map<number, TerminalSink>();

/** Route terminal `id`'s output and exit to `sink`, from now until it exits or is unbound. */
export function bindTerminal(id: number, sink: TerminalSink): void {
  sinks.set(id, sink);
}

/**
 * Stop routing `id`: what it still prints, and its exit, go nowhere.
 * For a panel that replaced its shell and does not want the old one's tail.
 */
export function unbindTerminal(id: number): void {
  sinks.delete(id);
}

let routed = false;

/**
 * Subscribe once to every terminal's data and exit, and hand each to whichever sink bound the id.
 * A terminal nobody bound — one whose tab was closed while it was still starting, or a panel's shell after a restart — is dropped here rather than each consumer guarding for it.
 */
export function routeTerminals(): void {
  if (routed) return;
  routed = true;
  window.claudeUi.onTerminalData((id, data) => sinks.get(id)?.data(data));
  window.claudeUi.onTerminalExit((id, exitCode) => {
    const sink = sinks.get(id);
    sinks.delete(id);
    sink?.exit(exitCode);
  });
}
