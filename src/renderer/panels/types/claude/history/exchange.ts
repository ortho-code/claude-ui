import type { Exchange, HistoryPin, ReplyPart } from '../../../../../shared/types';
import { relativeTime } from '../../../../ui/time-words';
import { showMoment, type Moment } from '../../../../ui/moments';
import { chevronIcon, PIN_ICON, PINNED_ICON } from '../../../../ui/svg';
import { setTooltip } from '../../../../ui/tooltip';
import { renderMarkdown } from './markdown';
import { replyBlocks, reportLine, toolSummary } from './model';
import './exchange.css';

const MARKS: Partial<Record<Exchange['kind'], [label: string, tooltip: string]>> = {
  busy: ['sent while claude was working', 'Sent while claude was still working on something else, and taken up by it.'],
};
const REPLACED: [string, string] = ['sent again', 'You stopped this and sent it again: the request below replaced it.'];
const REWOUND: [string, string] = ['rewound', "You went back to before this with claude's rewind and carried on from there, so claude's conversation no longer has it."];

/** What drawing an exchange needs of the history it is drawn in. */
export interface ExchangeDrawing {
  pins(): Readonly<Record<string, HistoryPin>>;
  /** The folded lines opened by hand, by exchange and the place in its reply's parts where the line starts. */
  readonly openFolds: Set<string>;
  pinRequest(exchange: Exchange): void;
  pinMessage(part: Extract<ReplyPart, { kind: 'text' }>): void;
}

/** Exchange `index` as the history draws it: your request on its line, and claude's reply under it. */
export function exchangeNode(exchange: Exchange, index: number, drawing: ExchangeDrawing): HTMLElement {
  const node = document.createElement('article');
  // Sent again or rewound past, it is no longer in claude's conversation, and is drawn the one way for both.
  node.className = `exchange${exchange.replaced || exchange.rewound ? ' left-behind' : ''}`;

  // Your request as claude echoes it, on a band, with its number, time and marks at the band's end.
  const request = document.createElement('div');
  request.className = 'exchange-request';
  const text = document.createElement('span');
  text.className = 'exchange-request-text';
  text.textContent = exchange.request;
  const meta = document.createElement('span');
  meta.className = 'exchange-meta';
  const when = document.createElement('span');
  // On the clock, since an exchange once drawn is kept as it is.
  const moment = (): Moment => ({ text: `#${index + 1} · ${exchange.time ? relativeTime(exchange.time) : ''}`, at: exchange.time || null, label: 'Sent' });
  showMoment(when, moment(), moment);
  const marks = [MARKS[exchange.kind], exchange.replaced ? REPLACED : undefined, exchange.rewound ? REWOUND : undefined].filter((m): m is [string, string] => m !== undefined);
  for (const [label, tooltip] of marks) {
    const mark = document.createElement('span');
    mark.className = 'exchange-mark';
    mark.textContent = label;
    setTooltip(mark, tooltip);
    meta.append(mark);
  }
  // The star stands where the `>` is, at the start of the line, and stands in for it on hover and once pinned, as a message's star does for its dot.
  const pin = document.createElement('button');
  pin.type = 'button';
  pin.className = 'icon-btn compact exchange-pin';
  pin.addEventListener('click', () => drawing.pinRequest(exchange));
  text.prepend(pin);
  meta.append(when);
  request.append(text, meta);

  // The reply as claude wrote it: each message its own block, the tool calls where they came between them, a run of them folded to one line, and a subagent's report folded to one line where it came back.
  const reply = document.createElement('div');
  reply.className = 'exchange-reply';
  for (const block of replyBlocks(exchange.parts)) {
    if (block.kind === 'text') {
      const part = block.part;
      const piece = document.createElement('div');
      piece.className = 'exchange-text exchange-markdown';
      piece.dataset.id = part.id;
      // Safe to hand to innerHTML: raw HTML in a reply comes out as text, and dangerous links not at all (markdown.ts).
      piece.innerHTML = renderMarkdown(part.text);
      // Its star sits where claude's dot is, at the message's start, and stands in for the dot on hover and once pinned.
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'icon-btn compact exchange-pin';
      star.addEventListener('click', () => drawing.pinMessage(part));
      piece.prepend(star);
      reply.append(piece);
    } else if (block.kind === 'tool') reply.append(toolLine(block.part));
    else if (block.kind === 'tools') {
      const list = document.createElement('div');
      list.append(...block.parts.map(toolLine));
      reply.append(fold(drawing, `${exchange.id}:${block.at}`, 'tools', toolSummary(block.parts), list, ['Show each tool call', 'Fold the tool calls']));
    } else {
      const report = document.createElement('div');
      report.className = 'exchange-markdown';
      // As safe as a message: a report is a subagent's words, rendered by the same rules (markdown.ts).
      report.innerHTML = renderMarkdown(block.part.text);
      reply.append(fold(drawing, `${exchange.id}:${block.at}`, 'report', reportLine(block.part), report, ['Show the report', 'Fold the report']));
    }
  }

  node.append(request, reply);
  drawPins(node, exchange, drawing.pins());
  return node;
}

/**
 * A line of the reply that opens into `body`, as claude folds one, closed until opened: a run of tool calls, "Ran 4 shell commands, read 1 file", opening into the calls, or a subagent's report, "claim-checker reported", opening into the report.
 * `kind` names what is folded, for the stylesheet; the tooltips say what a press does, shut and open.
 * Kept open or closed by `key` while the last exchange is drawn again as claude's reply grows.
 */
function fold(drawing: ExchangeDrawing, key: string, kind: string, line: string, body: HTMLElement, [shut, open]: [string, string]): HTMLElement {
  const box = document.createElement('div');
  box.className = `exchange-fold ${kind}`;
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'exchange-fold-head';
  const label = document.createElement('span');
  label.textContent = line;
  const chevron = document.createElement('span');
  chevron.className = 'exchange-fold-chevron';
  head.append(label, chevron);
  body.classList.add('exchange-fold-body');
  const draw = (): void => {
    const opened = drawing.openFolds.has(key);
    box.classList.toggle('open', opened);
    body.hidden = !opened;
    head.setAttribute('aria-expanded', String(opened));
    chevron.innerHTML = chevronIcon(opened ? 'down' : 'right', 12);
    setTooltip(head, opened ? open : shut);
  };
  head.addEventListener('click', () => {
    if (!drawing.openFolds.delete(key)) drawing.openFolds.add(key);
    draw();
  });
  draw();
  box.append(head, body);
  return box;
}

/** Draw the stars of an exchange: its request's and each of claude's messages'. */
export function drawPins(node: HTMLElement, exchange: Exchange, pins: Readonly<Record<string, HistoryPin>>): void {
  const star = node.querySelector<HTMLElement>('.exchange-request .exchange-pin');
  if (star) drawStar(node, star, exchange.id in pins, 'request');
  for (const piece of node.querySelectorAll<HTMLElement>('.exchange-text')) {
    const pin = piece.querySelector<HTMLElement>(':scope > .exchange-pin');
    if (pin) drawStar(piece, pin, (piece.dataset.id ?? '') in pins, 'message');
  }
}

/** A tool call as claude draws it: the name in bold, what it acted on in brackets after it. */
function toolLine(part: Extract<ReplyPart, { kind: 'tool' }>): HTMLElement {
  const piece = document.createElement('div');
  piece.className = 'exchange-tool';
  const name = document.createElement('span');
  name.className = 'exchange-tool-name';
  name.textContent = part.name;
  piece.append(name);
  if (part.detail) piece.append(`(${part.detail})`);
  return piece;
}

/** A star, like the session row's told apart by ink alone, filled or outlined; what it pins carries the accent line in the margin. */
function drawStar(owner: HTMLElement, star: HTMLElement, pinned: boolean, what: 'request' | 'message'): void {
  owner.classList.toggle('pinned', pinned);
  star.innerHTML = pinned ? PINNED_ICON : PIN_ICON;
  star.setAttribute('aria-pressed', String(pinned));
  const label = `${pinned ? 'Unpin' : 'Pin'} this ${what}`;
  star.setAttribute('aria-label', label);
  setTooltip(star, label);
}
