import { parseLaunchFlags } from '../shared/flags';
import type { FolderName } from '../shared/folders';
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES } from '../shared/log';
import type { SettingKey, SettingsView } from '../shared/settings';
import type { Settings } from '../shared/types';
import { listen, runModal } from './modal';
import { hideToast, showToast } from './toast';

// App preferences, from the config folder: your settings.json under the app's settings.local.json, which this dialog writes (shared/settings.ts).
// One section for now; the shape is per-section so a second one (a read-only view of the user's own Claude config) is an addition rather than a rework.
// Under a field, where its value comes from and what is wrong with either file's; under the section, what is wrong with a file as a whole.
// The app's own folders are one row each under it, built from SETTINGS_FOLDERS below.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="settings-overlay" class="overlay" hidden>
    <div id="settings-dialog" class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <p id="settings-title" class="dialog-title">Settings</p>
      <div class="dialog-section">
        <label class="dialog-label" for="settings-flags">Default launch flags</label>
        <p class="dialog-detail">Added to every session started from now on. Sessions already running keep the flags they started with.</p>
        <input id="settings-flags" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="--allowedTools Grep,Glob" />
        <p id="settings-error" class="dialog-error" hidden></p>
      </div>
      <div id="settings-notes" class="dialog-section" hidden>
        <span class="dialog-label">In the settings files</span>
        <div id="settings-notes-list"></div>
      </div>
      <div id="settings-folders"></div>
      <div class="dialog-actions">
        <button id="settings-cancel" type="button">Cancel</button>
        <button id="settings-ok" type="button" class="primary">Save</button>
      </div>
    </div>
  </div>`,
);
const settingsOverlay = document.getElementById('settings-overlay')!;
const settingsFlags = document.getElementById('settings-flags') as HTMLInputElement;
const settingsError = document.getElementById('settings-error')!;
const settingsOk = document.getElementById('settings-ok') as HTMLButtonElement;
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement;
const settingsFolders = document.getElementById('settings-folders')!;
const settingsNotes = document.getElementById('settings-notes')!;
const settingsNotesList = document.getElementById('settings-notes-list')!;

/**
 * The app's own folders, as Settings lists them: what each holds, where it is, and a button to open it.
 * Both are read-only here — the config folder is edited by hand, the logs are the app's — so a row only says where the folder is.
 * `detail` is the app's own text, never data, which is what makes it safe as markup.
 */
const SETTINGS_FOLDERS: { name: FolderName; label: string; detail: string }[] = [
  {
    name: 'config',
    label: 'Config folder',
    detail: 'Holds <code>settings.json</code>, your settings, which the ones saved here win over; <code>layouts/default.json</code>, which lays out the window and its panels; and the scripts it points at.',
  },
  {
    name: 'logs',
    label: 'Logs',
    detail: `What the app did, to send along when something goes wrong. It keeps the last ${KEEP_LOG_DATES} days it ran plus the ${KEEP_CRASH_LOGS} newest crash logs, and removes older ones itself. Any of them is safe to delete.`,
  },
];

/** One row per folder, built afresh each time Settings opens, from one shape so the rows cannot drift apart. */
function renderFolderRows(paths: Record<FolderName, string>): void {
  settingsFolders.replaceChildren(
    ...SETTINGS_FOLDERS.map(({ name, label, detail }) => {
      const section = document.createElement('div');
      section.className = 'dialog-section';
      const heading = document.createElement('span');
      heading.className = 'dialog-label';
      heading.textContent = label;
      const explanation = document.createElement('p');
      explanation.className = 'dialog-detail';
      explanation.innerHTML = detail;
      const row = document.createElement('div');
      row.className = 'dialog-row';
      const where = document.createElement('code');
      where.className = 'dialog-path';
      where.textContent = paths[name];
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = 'Open';
      open.addEventListener('click', () => window.claudeUi.openFolder(name));
      row.append(where, open);
      section.append(heading, explanation, row);
      return section;
    }),
  );
}

/** Lines of text, each a paragraph of `className`, in place of what `host` held. */
function lines(host: HTMLElement, className: string, texts: string[]): void {
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
interface Control<T> {
  element: HTMLInputElement;
  read(): T;
  write(value: T): void;
}

/** What a setting's lines say that is its own. */
interface Words<T> {
  /** What settings.json gives it, as "Set here, over …:" names it. */
  over: string;
  /** A value a file gives it that is not used, and why. */
  refused(file: string, why: string): string;
  /** settings.json's value, as the row beside its button shows it. */
  shown(value: T): string;
}

/**
 * One setting in the dialog: its control, and under it where its value comes from, the value it would have without the app's (settings.json's, or the default) with a button back to it, and what is wrong with a value either file gives it.
 * Every setting is one of these, so each has the same lines behaving the same way.
 */
class SettingField<K extends SettingKey> {
  /** Changed in the control since the dialog last filled it, which a change to the files while it is open must not overwrite. */
  private edited = false;
  /** "Use settings.json" pressed and the control not changed since: it holds the value without the app's (settings.json's, or the default), and saving takes the app's away. */
  private usingYours = false;
  /** The settings the field was last rendered from, which "Use settings.json" renders it from again. */
  private shown: SettingsView | null = null;
  private readonly from: HTMLElement;
  private readonly yours: HTMLElement;
  private readonly yoursValue: HTMLElement;
  private readonly use: HTMLButtonElement;
  private readonly problems: HTMLElement;

  constructor(
    private readonly key: K,
    readonly control: Control<Settings[K]>,
    private readonly words: Words<Settings[K]>,
  ) {
    // Right after the control, each named after the control's own id, so a line is found by the setting it belongs to.
    const id = control.element.id;
    control.element.insertAdjacentHTML(
      'afterend',
      `<p id="${id}-from" class="dialog-under" hidden></p>
        <div id="${id}-yours" class="dialog-row" hidden>
          <code id="${id}-yours-value" class="dialog-path"></code>
          <button id="${id}-use" type="button">Use settings.json</button>
        </div>
        <div id="${id}-problems"></div>`,
    );
    this.from = document.getElementById(`${id}-from`)!;
    this.yours = document.getElementById(`${id}-yours`)!;
    this.yoursValue = document.getElementById(`${id}-yours-value`)!;
    this.use = document.getElementById(`${id}-use`) as HTMLButtonElement;
    this.problems = document.getElementById(`${id}-problems`)!;
  }

  /** The dialog opened afresh: the control follows the files again. */
  reset(): void {
    this.edited = false;
    this.usingYours = false;
  }

  /** Fill from the settings as they stand: the control, unless it was changed, and under it where its value comes from and what is wrong. */
  render(view: SettingsView): void {
    this.shown = view;
    const setting = view[this.key];
    if (!this.edited) this.control.write(this.usingYours ? setting.without : setting.value);
    const fromApp = setting.source === 'app' && !this.usingYours;
    this.from.textContent = this.usingYours
      ? 'From settings.json, once you save.'
      : fromApp
        ? setting.withoutSource === 'yours'
          ? `Set here, over ${this.words.over}:`
          : 'Set here; settings.json sets none.'
        : 'From settings.json.';
    this.from.hidden = setting.source === 'default' && !this.usingYours;
    this.yours.hidden = !fromApp;
    this.yoursValue.textContent = setting.withoutSource === 'yours' ? this.words.shown(setting.without) : '';
    lines(
      this.problems,
      'dialog-error',
      setting.problems.map(({ file, why }) => this.words.refused(file, why)),
    );
  }

  /** What saving sends for it. */
  value(): Settings[K] {
    return this.control.read();
  }

  /** While the dialog is up: a change in the control, and "Use settings.json", each telling `changed` too. */
  listeners(changed: () => void): (() => void)[] {
    return [
      listen(this.control.element, 'input', () => {
        this.edited = true;
        this.usingYours = false;
        changed();
      }),
      listen(this.use, 'click', () => {
        this.edited = false;
        this.usingYours = true;
        changed();
        if (this.shown) this.render(this.shown);
        this.control.element.focus();
      }),
    ];
  }
}

const flagsField = new SettingField(
  'launchFlags',
  {
    element: settingsFlags,
    read: () => settingsFlags.value.trim(),
    write: (value) => {
      settingsFlags.value = value;
    },
  },
  {
    over: 'the flags in settings.json',
    refused: (file, why) => `The flags in ${file} are not used: ${why}`,
    shown: (value) => value,
  },
);

/** Every setting's field. */
const fields = [flagsField];

/** Fill the dialog from the settings as they stand: each setting's field, and under the section what is wrong with a file as a whole. */
function render(view: SettingsView): void {
  for (const field of fields) field.render(view);
  lines(settingsNotesList, 'dialog-error', view.notes);
  settingsNotes.hidden = view.notes.length === 0;
}

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other two dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen that will grow sections.
 * Saving is validated by the same parser the launcher uses (shared/flags.ts), so what the field accepts and what a session gets can't disagree.
 * It saves into the app's `settings.local.json`; a value equal to what your `settings.json` gives takes the app's away rather than copying it there (`appFileChanges`), which is all "Use settings.json" needs: it puts your value in the field.
 */
export async function openSettings(): Promise<void> {
  for (const field of fields) field.reset();
  render(await window.claudeUi.getSettings());
  settingsError.hidden = true;
  renderFolderRows(await window.claudeUi.getFolders());
  settingsOverlay.hidden = false;
  settingsFlags.focus();
  settingsFlags.select();
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a dialog that returns nothing, so `finish()` takes no argument
  await runModal<void>(settingsOverlay, undefined, (finish) => {
    const submit = async (): Promise<void> => {
      const launchFlags = flagsField.value();
      const { error } = parseLaunchFlags(launchFlags);
      if (error) {
        settingsError.textContent = error;
        settingsError.hidden = false;
        return;
      }
      const saved = await window.claudeUi.setSettings({ launchFlags });
      if (saved.refused !== null) {
        render(saved.view);
        settingsError.textContent = saved.refused;
        settingsError.hidden = false;
        return;
      }
      finish();
    };
    return [
      listen(settingsOk, 'click', () => void submit()),
      listen(settingsCancel, 'click', () => finish()),
      listen(settingsFlags, 'keydown', (event) => {
        if (event.key === 'Enter') void submit();
      }),
      // A change is the fix for an error, so clear it as soon as one is made rather than leaving a stale complaint under the field.
      ...fields.flatMap((field) =>
        field.listeners(() => {
          settingsError.hidden = true;
        }),
      ),
    ];
  });
}

/** The toast a settings file that does not parse put up, so the file being fixed takes down that one and never another. */
let toasted: string | null = null;

/** The settings as they now stand: a toast while either file does not parse, as the layout file gets one, and an open Settings kept current. */
function followSettings(view: SettingsView): void {
  const broken = [view.files.yours, view.files.app].find((file) => file.status === 'unparsable');
  const message = broken ? `${broken.name}: ${broken.error ?? 'it could not be read'}` : null;
  if (message !== toasted) {
    if (toasted !== null) hideToast(toasted);
    if (message !== null) showToast(message, true);
    toasted = message;
  }
  if (!settingsOverlay.hidden) render(view);
}

/** Follow the settings files from start-up on. */
export async function watchSettings(): Promise<void> {
  window.claudeUi.onSettingsChanged(followSettings);
  followSettings(await window.claudeUi.getSettings());
}
