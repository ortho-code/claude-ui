import { defaultSettings } from '../../../shared/config/defaults';
import type { SettingKey, SettingViews, SettingsView } from '../../../shared/config/settings';
import type { Settings } from '../../../shared/types';
import { listen } from '../../ui/modal';

/** Lines of text, each a paragraph of `className`, in place of what `host` held. */
export function lines(host: HTMLElement, className: string, texts: string[]): void {
  host.replaceChildren(
    ...texts.map((text) => {
      const line = document.createElement('p');
      line.className = className;
      line.textContent = text;
      return line;
    }),
  );
}

/** How a setting's control shows a value and gives it back. */
export interface Control<T> {
  /** The field, the dropdown or the checkbox: its id names the setting's lines, and an input event on it is the setting changed. */
  element: HTMLInputElement | HTMLSelectElement;
  /** What the setting's lines go after: the control itself, unless it sits inside its own words, as the PR status checkbox does in its label. */
  after?: HTMLElement;
  read(): T;
  write(value: T): void;
}

/**
 * One setting in the dialog: its control, and under it, when the file gives it a value that is not used, that and why, in `refused`'s words.
 * Every setting is one of these, so each has the same line behaving the same way.
 */
export class SettingField<K extends SettingKey> {
  /** Changed in the control since the dialog last filled it, which a change to the file while it is open must not overwrite. */
  private edited = false;
  private readonly problems: HTMLElement;

  constructor(
    readonly key: K,
    readonly control: Control<Settings[K]>,
    private readonly refused: (file: string, why: string) => string,
  ) {
    // Right after the control, or what holds it, named after the control's own id, so the line is found by the setting it belongs to.
    const id = control.element.id;
    // Then where it says its default, when it differs from it, named after its key as every such line is (`defaultHostOf`).
    (control.after ?? control.element).insertAdjacentHTML('afterend', `<div id="${id}-problems"></div><div id="settings-${key}-default" class="settings-default" hidden></div>`);
    this.problems = document.getElementById(`${id}-problems`)!;
    // So "Only what differs" finds the setting's group by its key, as it finds the parts without a field.
    control.element.closest<HTMLElement>('.dialog-group')!.dataset.setting = key;
  }

  /** The dialog opened afresh: the control follows the file again. */
  reset(): void {
    this.edited = false;
  }

  /** The app's default in the control, as an edit, so a change to the file while the dialog is open does not take it back. */
  resetToDefault(): void {
    this.edited = true;
    this.control.write(defaultSettings()[this.key]);
  }

  /** Mark the setting's group as holding a change a save would write, when `pending` names it. */
  showChanged(pending: readonly SettingKey[]): void {
    this.control.element.closest('.dialog-group')!.classList.toggle('has-change', pending.includes(this.key));
  }

  /** Fill from the settings as they stand: the control, unless it was changed, and under it what is wrong with the file's value. */
  render(view: SettingsView): void {
    const views: SettingViews = view;
    const setting = views[this.key];
    if (!this.edited) this.control.write(setting.value);
    lines(this.problems, 'dialog-error', setting.problem === null ? [] : [this.refused(view.file.name, setting.problem)]);
  }

  /** What saving sends for it. */
  value(): Settings[K] {
    return this.control.read();
  }

  /** While the dialog is up: a change in the control, telling `changed` too. */
  listeners(changed: () => void): (() => void)[] {
    return [
      listen(this.control.element, 'input', () => {
        this.edited = true;
        changed();
      }),
    ];
  }
}
