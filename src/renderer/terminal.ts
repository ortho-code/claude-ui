import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { errorText } from '../shared/log';
import { pastedPaths } from '../shared/paste';

/**
 * The xterm every terminal in the window is built from — a tab's `claude` and a panel's shell — and the one place their output and exits are routed.
 * One construction rather than two, because the options here are decisions (the font tokens, the neutral foreground, the canvas fallback, clickable links, what Ctrl+V does) that would otherwise be made twice and drift.
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

// Whether this is WSL, which main answers once (`askPlatform`); until it has, every key goes on as it does elsewhere.
let wsl = false;

/** Ask main, once at startup, whether the app runs under WSL, which decides what Ctrl+V does (`pastesHere`). */
export async function askPlatform(): Promise<void> {
  wsl = await window.claudeUi.isWsl();
}

/**
 * Whether `event` is a Ctrl+V the terminal pastes from the clipboard, rather than sending it on to what runs in it.
 * Only under WSL, where claude reads Ctrl+V as "paste an image" and looks for one before it falls back to text, through xclip or wl-paste where there is one and then powershell.exe, whose call took ten seconds the first time it was measured.
 * An image still reaches claude: a clipboard with no text pastes as an empty paste (in the app under WSLg, as in the window's checks), which claude under WSL reads as an image paste, and Alt+V is its own image key there.
 * Not on macOS, where Cmd+V is the paste and Ctrl+V is claude's, as in Terminal.app, nor on native Linux, where Ctrl+V is claude's only image key and an empty paste reads no image.
 * Matched by the letter the key types, so on a layout whose V key types another letter, such as a Cyrillic one, the key goes on as before.
 */
function pastesHere(event: KeyboardEvent): boolean {
  return wsl && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === 'v';
}

/** Whether `event` is a key Chromium pastes the clipboard on, once `pastesHere` has handed Ctrl+V back: Ctrl+V, Ctrl+Shift+V or Shift+Insert. */
function isPasteKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.metaKey) return false;
  if (event.ctrlKey) return event.key.toLowerCase() === 'v';
  return event.shiftKey && event.key === 'Insert';
}

/** How soon after a paste key a paste counts as the key's: a paste a key asks for follows it at once, while a middle-click's counts only if one of those keys was pressed this shortly before. */
const PASTE_KEY_MS = 1_000;

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

/**
 * An xterm opened in `container`, sized to it by the fit addon, drawn on canvas where that works, with http(s) links clickable.
 * `keys` is the caller's own say over a key, asked after the keys every terminal takes for itself, and answered as xterm's custom key handler is: false keeps the key from the terminal.
 * It is passed here rather than attached by the caller, because xterm holds one handler and a second would replace the first.
 */
export function createTerminal(container: HTMLElement, keys?: (event: KeyboardEvent) => boolean): TerminalView {
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

  // A key handed back to the browser is one xterm leaves alone without cancelling, so Chromium's own paste runs into xterm's textarea, which pastes it as one paste, bracketed where the program asked for that.
  let pasteKeyAt = -Infinity;
  term.attachCustomKeyEventHandler((event) => {
    if (event.type === 'keydown' && isPasteKey(event)) pasteKeyAt = event.timeStamp;
    if (pastesHere(event)) return false;
    return keys ? keys(event) : true;
  });

  // Under WSL a paste from a key that brings no text may be files copied in Explorer, which only Windows has: main is asked for them, and their paths are pasted instead, or nothing, as the paste came, where there are none (`copiedFiles`).
  // Caught on the way down, before xterm's own handling on its element and its textarea, which would send the paste on at once.
  container.addEventListener(
    'paste',
    (event) => {
      if (!wsl || event.timeStamp - pasteKeyAt > PASTE_KEY_MS) return;
      pasteKeyAt = -Infinity;
      if (event.clipboardData?.getData('text/plain')) return;
      event.preventDefault();
      event.stopPropagation();
      void window.claudeUi
        .copiedFiles()
        .catch(() => [])
        .then((paths) => {
          // Its tab or shell may have closed meanwhile.
          if (term.element?.isConnected) term.paste(pastedPaths(paths));
        });
    },
    true,
  );

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
