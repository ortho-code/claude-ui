import type { SupersededCopy } from '../../../../../shared/types';
import { momentInLanguage } from '../../../../ui/locale';
import { chevronIcon, PINNED_ICON } from '../../../../ui/svg';
import { setTooltip } from '../../../../ui/tooltip';
import { drawDockButton } from '../../../headers';
// The filter pill its All · Pinned wear, shared with the sidebar's filter.
import '../../../../ui/pill.css';
import './head.css';

/** What a press in the history's head asks of the view. */
export interface HeadActions {
  /** Show every request, or only the ones holding a pin. */
  filter(pinnedOnly: boolean): void;
  /** Go to the previous (-1) or next (+1) request. */
  step(by: number): void;
  /** Back to the live session, or close a history standing in for one or docked beside it. */
  leave(): void;
  /** Dock it beside the live session, or put it back in the drawer. */
  toggleDock(): void;
  /** Show the older copy with this stamp, or the session's transcript for null. */
  source(stamp: string | null): void;
}

/** The history's head: its title, the switch between every request and the pinned ones with their counts, the steps between requests, and the way back to live. */
export class HistoryHead {
  readonly el = document.createElement('div');
  private readonly allButton = document.createElement('button');
  private readonly pinnedButton = document.createElement('button');
  private readonly dockButton = document.createElement('button');
  private readonly leaveButton = document.createElement('button');
  /** The switch between the session's transcript and its older copies, there only while it has one. */
  private readonly copies = document.createElement('span');
  private onlyPinned = false;

  constructor(private readonly actions: HeadActions) {
    this.el.className = 'history-head';
    const title = document.createElement('span');
    title.className = 'history-title';
    title.textContent = 'History';
    // What is shown, as a labelled switch with the counts on it: all the requests, or only the pinned ones.
    // An unlabelled star did not say it was a filter.
    const show = document.createElement('span');
    show.className = 'history-show';
    for (const [button, pinnedOnly, tooltip] of [
      [this.allButton, false, 'Show every request'],
      [this.pinnedButton, true, 'Show only the pinned requests'],
    ] as const) {
      button.type = 'button';
      button.className = 'pill';
      setTooltip(button, tooltip);
      button.addEventListener('click', () => {
        this.onlyPinned = pinnedOnly;
        this.drawSwitch();
        this.actions.filter(pinnedOnly);
      });
      show.append(button);
    }
    const grow = document.createElement('span');
    grow.className = 'grow';
    const previous = this.stepButton('up', 'Previous request (Ctrl+Shift+↑)', -1);
    const next = this.stepButton('down', 'Next request (Ctrl+Shift+↓)', 1);
    this.dockButton.type = 'button';
    this.dockButton.className = 'icon-btn compact history-dock-button';
    this.dockButton.addEventListener('click', () => this.actions.toggleDock());
    // The way out, labelled and always in view at the head, with its key on it: a floating pill at the foot was not found.
    this.leaveButton.type = 'button';
    this.leaveButton.className = 'history-leave';
    this.leaveButton.addEventListener('click', () => this.actions.leave());
    this.copies.className = 'history-show history-copies';
    this.copies.hidden = true;
    this.el.append(title, show, this.copies, grow, previous, next, this.dockButton, this.leaveButton);
    this.setDocked(false, true);
  }

  /** Draw the switch for the session's older copies, the one with stamp `shown` on, or the transcript for null; none for a session without one. */
  setCopies(copies: readonly SupersededCopy[], shown: string | null): void {
    this.copies.hidden = copies.length === 0;
    const choices: { stamp: string | null; label: string; tooltip: string }[] = [
      { stamp: null, label: 'Current', tooltip: "Show the session's transcript" },
      ...copies.map(({ stamp, at, missing }) => ({ stamp, label: `Older copy, ${momentInLanguage(at)} · ${missing} not in current`, tooltip: 'Show this older copy of the session, read-only' })),
    ];
    this.copies.replaceChildren(
      ...choices.map(({ stamp, label, tooltip }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pill';
        button.textContent = label;
        setTooltip(button, tooltip);
        button.classList.toggle('active', stamp === shown);
        button.setAttribute('aria-pressed', String(stamp === shown));
        button.addEventListener('click', () => this.actions.source(stamp));
        return button;
      }),
    );
  }

  /**
   * Say whether it is docked, and whether it can be: not while it stands in for a cold tab, where there is no terminal to dock beside.
   * Docked, the way out is Close, since the tab's terminal is in view beside it.
   */
  setDocked(docked: boolean, canDock: boolean): void {
    this.dockButton.hidden = !canDock;
    drawDockButton(this.dockButton, docked);
    const closes = docked && canDock;
    this.leaveButton.innerHTML = closes ? 'Close' : 'Back to live <kbd>Esc</kbd>';
    setTooltip(this.leaveButton, closes ? 'Close the history' : 'Back to the live session');
  }

  /** Whether only the requests holding a pin are on show. */
  get pinnedOnly(): boolean {
    return this.onlyPinned;
  }

  /** Say how many requests there are, and how many pins they hold. */
  count(total: number, pinned: number): void {
    this.allButton.textContent = `All ${total}`;
    this.pinnedButton.innerHTML = `${PINNED_ICON} Pinned ${pinned}`;
    this.drawSwitch();
  }

  private drawSwitch(): void {
    this.allButton.classList.toggle('active', !this.onlyPinned);
    this.allButton.setAttribute('aria-pressed', String(!this.onlyPinned));
    this.pinnedButton.classList.toggle('active', this.onlyPinned);
    this.pinnedButton.setAttribute('aria-pressed', String(this.onlyPinned));
  }

  private stepButton(direction: 'up' | 'down', label: string, step: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-btn compact';
    button.innerHTML = chevronIcon(direction, 14);
    button.setAttribute('aria-label', label);
    setTooltip(button, label);
    button.addEventListener('click', () => this.actions.step(step));
    return button;
  }
}
