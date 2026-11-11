import { chevronIcon, PINNED_ICON } from '../../../../ui/svg';
import { setTooltip } from '../../../../ui/tooltip';

/** What a press in the history's head asks of the view. */
export interface HeadActions {
  /** Show every request, or only the ones holding a pin. */
  filter(pinnedOnly: boolean): void;
  /** Go to the previous (-1) or next (+1) request. */
  step(by: number): void;
  /** Back to the live session, or close a history standing in for one. */
  leave(): void;
}

/** The history's head: its title, the switch between every request and the pinned ones with their counts, the steps between requests, and the way back to live. */
export class HistoryHead {
  readonly el = document.createElement('div');
  private readonly allButton = document.createElement('button');
  private readonly pinnedButton = document.createElement('button');
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
      button.className = 'history-filter';
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
    // The way out, labelled and always in view at the head, with its key on it: a floating pill at the foot was not found.
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'history-leave';
    leave.innerHTML = 'Back to live <kbd>Esc</kbd>';
    setTooltip(leave, 'Back to the live session');
    leave.addEventListener('click', () => this.actions.leave());
    this.el.append(title, show, grow, previous, next, leave);
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
