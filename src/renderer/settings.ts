import { parseLaunchFlags } from '../shared/flags';
import type { FolderName } from '../shared/folders';
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES } from '../shared/log';
import { presetsProblem } from '../shared/setaside';
import { timeOfDay } from '../shared/time';
import { languageTag, LEAVE_BUTTON, RUNNING_AT_LAUNCH, type LeaveButton, type RunningAtLaunch, type SettingKey, type SettingViews, type SettingsView } from '../shared/settings';
import type { Settings } from '../shared/types';
import { listen, runModal } from './modal';
import { store, type View } from './state/app';
import { hideToast, showToast } from './toast';

/** Each choice for the sessions that were running when the app closed, in words: the dropdown's options. */
const RUNNING_LABELS: Record<RunningAtLaunch, string> = {
  start: 'Start them again',
  cold: 'Bring their tabs back without starting them',
};

/** Each choice for a tab's button, in words: the dropdown's options. */
const LEAVE_BUTTON_LABELS: Record<LeaveButton, string> = {
  'stop-close': 'Stop, then close the tab',
  'stop-finish': 'Stop, then mark the session finished',
  close: 'Close the tab',
  finish: 'Mark the session finished',
  none: 'No button, only the menu',
};

// App preferences, from the config folder: settings.json, which you edit and this dialog saves into (shared/settings.ts), said once under the title.
// Under a field, a value of the file's that is not used and why; in a block of its own, what is wrong with the file as a whole.
// The app's own folders are one row each under it, built from SETTINGS_FOLDERS below.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="settings-overlay" class="overlay" hidden>
    <div id="settings-dialog" class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <p id="settings-title" class="dialog-title">Settings</p>
      <p class="dialog-detail">Saved in <code>settings.json</code> in the config folder, where you can edit them by hand too.</p>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-flags">Default launch flags</label>
        <p class="dialog-detail">Added to every session started from now on. Sessions already running keep the flags they started with.</p>
        <input id="settings-flags" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="--allowedTools Grep,Glob" />
        <p id="settings-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-running">Sessions running when the app closed</label>
        <p class="dialog-detail">What the next launch does with them. A marked one stays marked until your next prompt there. The other tabs come back waiting for a click.</p>
        <select id="settings-running" class="dialog-field">
          ${RUNNING_AT_LAUNCH.map((choice) => `<option value="${choice}">${RUNNING_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <span class="dialog-label">Pull requests</span>
        <p class="dialog-detail">A session's PR badge takes the colour of what GitHub says of its PRs, such as changes requested, failing checks or merged, and a PR changing like that marks the session as needing you. The app asks with gh, on your own login. Turned on, it starts from the PRs as they are then.</p>
        <label id="settings-pr-status-row" class="dialog-choice"><input id="settings-pr-status" type="checkbox" /> PR status from GitHub</label>
        <p class="dialog-detail">How many approvals a repository's PRs need before they count as approved is <code>approvals</code> in settings.json, set there by hand; a repository it does not name counts as approved when GitHub says so.</p>
        <div id="settings-approvals-problems"></div>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-leave-button">Leave button</label>
        <p class="dialog-detail">The button beside a session's menu on its tab, which a middle-click on the tab presses too. A running session is asked to leave first, whichever it is. Without the button, the session's menu holds it all.</p>
        <select id="settings-leave-button" class="dialog-field">
          ${LEAVE_BUTTON.map((choice) => `<option value="${choice}">${LEAVE_BUTTON_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside">Set aside: the choices</label>
        <p class="dialog-detail">Separated by commas, offered in the order they come, with Pick a date… beside them and whenever last: whenever, in 30m, in 2h, in 3d, in 1w, tomorrow or next monday, a day with a time such as 09:00 or else the time below.</p>
        <input id="settings-set-aside" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="tomorrow, in 1w, whenever" />
        <p id="settings-set-aside-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside-time">Time of day for a choice without one</label>
        <p class="dialog-detail">A session set aside for a day without a time needs you again at this time on that day. Pick a date…'s time starts at it.</p>
        <input id="settings-set-aside-time" class="dialog-field" type="time" />
        <p id="settings-set-aside-time-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-locale">Language for times and dates</label>
        <p class="dialog-detail">A language tag such as en-GB or nl-NL, or empty for the system's. Time fields follow this from the next launch; the rest of the app at once.</p>
        <input id="settings-locale" class="dialog-field" type="text" spellcheck="false" autocomplete="off" />
        <p id="settings-locale-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <span class="dialog-label">Status dots</span>
        <p class="dialog-detail">Which state a session's dot shows when several hold, such as busy and needing you, is <code>strength</code> in settings.json, and how each status, category and type is drawn is <code>looks</code>, both set there by hand.</p>
        <div id="settings-dots-problems"></div>
      </div>
      <div id="settings-notes" class="dialog-group" hidden>
        <span class="dialog-label">In settings.json</span>
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
const settingsRunning = document.getElementById('settings-running') as HTMLSelectElement;
const settingsPrStatus = document.getElementById('settings-pr-status') as HTMLInputElement;
const settingsLeaveButton = document.getElementById('settings-leave-button') as HTMLSelectElement;
const settingsSetAside = document.getElementById('settings-set-aside') as HTMLInputElement;
const settingsSetAsideError = document.getElementById('settings-set-aside-error')!;
const settingsSetAsideTime = document.getElementById('settings-set-aside-time') as HTMLInputElement;
const settingsSetAsideTimeError = document.getElementById('settings-set-aside-time-error')!;
const settingsLocale = document.getElementById('settings-locale') as HTMLInputElement;
const settingsLocaleError = document.getElementById('settings-locale-error')!;
// The system's language is what an empty field means, so it is what the field shows while empty.
settingsLocale.placeholder = navigator.language;
const settingsError = document.getElementById('settings-error')!;
const settingsOk = document.getElementById('settings-ok') as HTMLButtonElement;
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement;
const settingsFolders = document.getElementById('settings-folders')!;
const settingsNotes = document.getElementById('settings-notes')!;
const settingsNotesList = document.getElementById('settings-notes-list')!;
const settingsDotsProblems = document.getElementById('settings-dots-problems')!;
const settingsApprovalsProblems = document.getElementById('settings-approvals-problems')!;

/**
 * The app's own folders, as Settings lists them: what each holds, where it is, and a button to open it.
 * Both are read-only here — the config folder is edited by hand, the logs are the app's — so a row only says where the folder is.
 * `detail` is the app's own text, never data, which is what makes it safe as markup.
 */
const SETTINGS_FOLDERS: { name: FolderName; label: string; detail: string }[] = [
  {
    name: 'config',
    label: 'Config folder',
    detail: 'Holds <code>settings.json</code>, the settings above; <code>layouts/default.json</code>, which lays out the window and its panels; and the scripts it points at.',
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
      const group = document.createElement('div');
      group.className = 'dialog-group';
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
      group.append(heading, explanation, row);
      return group;
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
class SettingField<K extends SettingKey> {
  /** Changed in the control since the dialog last filled it, which a change to the file while it is open must not overwrite. */
  private edited = false;
  private readonly problems: HTMLElement;

  constructor(
    private readonly key: K,
    readonly control: Control<Settings[K]>,
    private readonly refused: (file: string, why: string) => string,
  ) {
    // Right after the control, or what holds it, named after the control's own id, so the line is found by the setting it belongs to.
    const id = control.element.id;
    (control.after ?? control.element).insertAdjacentHTML('afterend', `<div id="${id}-problems"></div>`);
    this.problems = document.getElementById(`${id}-problems`)!;
  }

  /** The dialog opened afresh: the control follows the file again. */
  reset(): void {
    this.edited = false;
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

const flagsField = new SettingField(
  'launchFlags',
  {
    element: settingsFlags,
    read: () => settingsFlags.value.trim(),
    write: (value) => {
      settingsFlags.value = value;
    },
  },
  (file, why) => `The flags in ${file} are not used: ${why}`,
);

const runningField = new SettingField(
  'runningSessionsAtLaunch',
  {
    element: settingsRunning,
    // Its options are the choices themselves, so what it holds is always one of them.
    read: () => settingsRunning.value as RunningAtLaunch,
    write: (value) => {
      settingsRunning.value = value;
    },
  },
  (file, why) => `The choice in ${file} is not used: ${why}`,
);

const prStatusField = new SettingField(
  'prStatus',
  {
    element: settingsPrStatus,
    after: document.getElementById('settings-pr-status-row')!,
    read: () => settingsPrStatus.checked,
    write: (value) => {
      settingsPrStatus.checked = value;
    },
  },
  (file, why) => `The choice in ${file} is not used: ${why}`,
);

const leaveButtonField = new SettingField(
  'leaveButton',
  {
    element: settingsLeaveButton,
    // Its options are the choices themselves, so what it holds is always one of them.
    read: () => settingsLeaveButton.value as LeaveButton,
    write: (value) => {
      settingsLeaveButton.value = value;
    },
  },
  (file, why) => `The choice in ${file} is not used: ${why}`,
);

const setAsideField = new SettingField(
  'setAside',
  {
    element: settingsSetAside,
    // The choices as written, comma-separated, which none of them holds; an empty field is the empty list.
    read: () =>
      settingsSetAside.value
        .split(',')
        .map((choice) => choice.trim())
        .filter((choice) => choice !== ''),
    write: (value) => {
      settingsSetAside.value = value.join(', ');
    },
  },
  (file, why) => `The choices in ${file} are not used: ${why}`,
);

const setAsideTimeField = new SettingField(
  'setAsideTime',
  {
    element: settingsSetAsideTime,
    // A time input holds "HH:MM" in 24 hours whatever the system's clock shows, or nothing once cleared, which the save refuses.
    read: () => settingsSetAsideTime.value,
    write: (value) => {
      settingsSetAsideTime.value = value;
    },
  },
  (file, why) => `The time in ${file} is not used: ${why}`,
);

const localeField = new SettingField(
  'locale',
  {
    element: settingsLocale,
    read: () => settingsLocale.value.trim(),
    write: (value) => {
      settingsLocale.value = value;
    },
  },
  (file, why) => `The language in ${file} is not used: ${why}`,
);

/** Every setting's field. */
const fields = [flagsField, runningField, prStatusField, leaveButtonField, setAsideField, setAsideTimeField, localeField];

/** Fill the dialog from the settings as they stand: each setting's field, what is wrong with those set only by hand, and in a block of its own what is wrong with the file as a whole. */
function render(view: SettingsView): void {
  for (const field of fields) field.render(view);
  lines(settingsDotsProblems, 'dialog-error', [
    ...(view.strength.problem === null ? [] : [`The order in ${view.file.name} is not used: ${view.strength.problem}`]),
    ...(view.looks.problem === null ? [] : [`The looks in ${view.file.name} are not used: ${view.looks.problem}`]),
  ]);
  lines(settingsApprovalsProblems, 'dialog-error', view.approvals.problem === null ? [] : [`The approvals in ${view.file.name} are not used: ${view.approvals.problem}`]);
  lines(settingsNotesList, 'dialog-error', view.notes);
  settingsNotes.hidden = view.notes.length === 0;
}

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other two dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen that will grow sections.
 * Saving is validated by the same parser the launcher uses (shared/flags.ts), so what the field accepts and what a session gets can't disagree.
 * It saves into `settings.json`, writing a setting whose value changed, or whose value in the file is not used (`fileChanges`), so a save that changes nothing leaves a file with no such value as it was.
 */
export async function openSettings(): Promise<void> {
  for (const field of fields) field.reset();
  // Kept as any read of main's is, so a change main tells of that was read before it cannot draw older settings over it.
  keepSettings(await window.claudeUi.getSettings());
  render(store.get().settings!);
  settingsError.hidden = true;
  settingsSetAsideError.hidden = true;
  settingsSetAsideTimeError.hidden = true;
  settingsLocaleError.hidden = true;
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
      const setAside = setAsideField.value();
      // The setting's own check, so the field refuses what the file would not use.
      const choicesWrong = presetsProblem(setAside);
      settingsSetAsideError.hidden = choicesWrong === null;
      if (choicesWrong !== null) {
        settingsSetAsideError.textContent = choicesWrong;
        return;
      }
      const setAsideTime = setAsideTimeField.value();
      settingsSetAsideTimeError.hidden = timeOfDay(setAsideTime) !== null;
      if (!settingsSetAsideTimeError.hidden) {
        settingsSetAsideTimeError.textContent = 'Give a time of day.';
        return;
      }
      const locale = localeField.value();
      settingsLocaleError.hidden = languageTag(locale) !== null;
      if (!settingsLocaleError.hidden) {
        settingsLocaleError.textContent = 'Give a language tag such as en-GB, or leave it empty for the system\'s.';
        return;
      }
      const saved = await window.claudeUi.setSettings({ launchFlags, runningSessionsAtLaunch: runningField.value(), prStatus: prStatusField.value(), leaveButton: leaveButtonField.value(), setAside, setAsideTime, locale });
      // Main does not tell the window of a change that is all its own write, so the settings as the save left them are kept here.
      keepSettings(saved.view);
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

/**
 * Keep `view` in the store, unless the store holds one from a later read of main's (`SettingsView.read`), and say whether it did.
 * A change main tells of is read before it is sent, so it can arrive after a save's answer though read before the save wrote, and must not put the old settings back.
 */
function keepSettings(view: SettingsView): boolean {
  const kept = store.get().settings;
  if (kept !== null && kept.read > view.read) return false;
  store.set({ settings: view });
  return true;
}

/** The settings as they now stand, unless the window has them from a later read already: in the store, and an open Settings drawn again with them. */
function followSettings(view: SettingsView): void {
  if (keepSettings(view) && !settingsOverlay.hidden) render(view);
}

/**
 * A toast while the file does not parse, as the layout file gets one, from the settings the store keeps, which a save keeps as well as main's telling.
 * So a file that broke while a save was out is toasted from the save's answer, though main's telling of it lands after and is not kept.
 */
function toastFollows({ settings }: View<'settings'>): void {
  const broken = settings?.file.status === 'unparsable' ? settings.file : undefined;
  const message = broken ? `${broken.name}: ${broken.error ?? 'it could not be read'}` : null;
  if (message === toasted) return;
  if (toasted !== null) hideToast(toasted);
  if (message !== null) showToast(message, true);
  toasted = message;
}

/** Follow the settings file from start-up on. */
export async function watchSettings(): Promise<void> {
  store.watch(['settings'], toastFollows);
  window.claudeUi.onSettingsChanged(followSettings);
  followSettings(await window.claudeUi.getSettings());
}
