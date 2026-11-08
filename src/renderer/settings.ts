import { parseLaunchFlags } from '../shared/flags';
import type { FolderName } from '../shared/folders';
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES } from '../shared/log';
import { presetsProblem } from '../shared/setaside';
import { timeOfDay } from '../shared/time';
import { fileChanges, languageTag, LEAVE_BUTTON, RUNNING_AT_LAUNCH, type LeaveButton, type RunningAtLaunch, type SettingKey, type SettingViews, type SettingsView } from '../shared/settings';
import type { Settings } from '../shared/types';
import { listen, runModal } from './modal';
import { store, type View } from './state/app';
import { hideToast, showToast } from './toast';
// The section list's entries are menu rows.
import './menu-row.css';
import './settings.css';

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

type SectionId = 'general' | 'sessions' | 'needs-you' | 'appearance' | 'version-control' | 'logs';

/** One of Settings' sections: its place in the list, and the settings whose mistakes mark it there. */
interface Section {
  id: SectionId;
  label: string;
  keys: SettingKey[];
  /** Its settings' markup: the app's own text, never data. */
  body: string;
}

/** The config folder's Open, ending each part Settings shows but cannot change, so it says where that part is changed; one press handler serves them all. */
const OPEN_CONFIG = '<button type="button" class="settings-open-config">Open config folder</button>';

/** Every section, in the list's order; a section with nothing to show yet is not here. */
const SECTIONS: Section[] = [
  {
    id: 'general',
    label: 'General',
    keys: ['launchFlags', 'locale', 'runningSessionsAtLaunch'],
    body: `
      <div class="dialog-group">
        <label class="dialog-label" for="settings-flags">Default launch flags</label>
        <p class="dialog-detail">Added to every session started from now on. Sessions already running keep the flags they started with.</p>
        <input id="settings-flags" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="--allowedTools Grep,Glob" />
        <p id="settings-flags-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-locale">Language for times and dates</label>
        <p class="dialog-detail">A language tag such as en-GB or nl-NL, or empty for the system's. Time fields follow this from the next launch; the rest of the app at once.</p>
        <input id="settings-locale" class="dialog-field" type="text" spellcheck="false" autocomplete="off" />
        <p id="settings-locale-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-running">Sessions running when the app closed</label>
        <p class="dialog-detail">What the next launch does with them. A marked one stays marked until your next prompt there. The other tabs come back waiting for a click.</p>
        <select id="settings-running" class="dialog-field">
          ${RUNNING_AT_LAUNCH.map((choice) => `<option value="${choice}">${RUNNING_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div id="settings-folder-config"></div>`,
  },
  {
    id: 'sessions',
    label: 'Sessions',
    keys: ['leaveButton', 'setAside', 'setAsideTime'],
    body: `
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
      </div>`,
  },
  {
    id: 'needs-you',
    label: 'Needs you',
    keys: ['needsYou'],
    body: `
      <div class="dialog-group">
        <span class="dialog-label">What can mark a session</span>
        <p class="dialog-detail">Which reasons mark a session as needing you, and in which section of Now each shows, is <code>needsYou</code> in settings.json, set there by hand: by a type's or a category's id, the fields it changes, such as <code>"needsYou": { "pr.merged": { "enabled": false } }</code> to be marked no more when a PR is merged.</p>
        ${OPEN_CONFIG}
        <div id="settings-needs-you-problems"></div>
      </div>`,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    keys: ['strength', 'looks'],
    body: `
      <div class="dialog-group">
        <span class="dialog-label">Status dots</span>
        <p class="dialog-detail">Which state a session's dot shows when several hold, such as busy and needing you, is <code>strength</code> in settings.json, and how each status, category and type is drawn is <code>looks</code>, both set there by hand.</p>
        ${OPEN_CONFIG}
        <div id="settings-dots-problems"></div>
      </div>`,
  },
  {
    id: 'version-control',
    label: 'Version control',
    keys: ['prStatus', 'approvals'],
    body: `
      <div class="settings-part">
        <h3 class="settings-part-heading">GitHub</h3>
        <div class="dialog-group">
          <span class="dialog-label">Pull requests</span>
          <p class="dialog-detail">A session's PR badge takes the colour of what GitHub says of its PRs, such as changes requested, failing checks or merged, and a PR changing like that marks the session as needing you. The app asks with gh, on your own login. Turned on, it starts from the PRs as they are then.</p>
          <label id="settings-pr-status-row" class="dialog-choice"><input id="settings-pr-status" type="checkbox" /> PR status from GitHub</label>
        </div>
        <div class="dialog-group">
          <span class="dialog-label">Approvals</span>
          <p class="dialog-detail">How many approvals a repository's PRs need before they count as approved is <code>approvals</code> in settings.json, set there by hand; a repository it does not name counts as approved when GitHub says so.</p>
          ${OPEN_CONFIG}
          <div id="settings-approvals-problems"></div>
        </div>
      </div>`,
  },
  {
    id: 'logs',
    label: 'Logs',
    keys: [],
    body: '<div id="settings-folder-logs"></div>',
  },
];

// App preferences, from the config folder: settings.json, which you edit and this dialog saves into (shared/settings.ts), said once under the title.
// Under a field, a value of the file's that is not used and why; under the title, over every section, what is wrong with the file as a whole.
// The sections are a vertical tab list beside the one on show, all in one box of fixed size, so switching never moves Save under the pointer.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="settings-overlay" class="overlay" hidden>
    <div id="settings-dialog" class="dialog settings" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <p id="settings-title" class="dialog-title">Settings</p>
      <p class="dialog-detail">Saved in <code>settings.json</code> in the config folder, where you can edit them by hand too.</p>
      <div id="settings-notes" class="dialog-group" hidden>
        <span class="dialog-label">In settings.json</span>
        <div id="settings-notes-list"></div>
      </div>
      <div class="settings-body">
        <div id="settings-sections" role="tablist" aria-orientation="vertical" aria-label="Sections">
          ${SECTIONS.map(({ id, label }) => `<button type="button" id="settings-tab-${id}" class="menu-row settings-tab" role="tab" aria-controls="settings-section-${id}">${label}</button>`).join('')}
        </div>
        ${SECTIONS.map(({ id, label, body }) => `<section id="settings-section-${id}" class="settings-section" role="tabpanel" aria-labelledby="settings-tab-${id}" hidden><h2 class="settings-heading">${label}</h2>${body}</section>`).join('')}
      </div>
      <p id="settings-save-error" class="dialog-error" hidden></p>
      <div class="dialog-actions">
        <button id="settings-cancel" type="button">Cancel</button>
        <button id="settings-ok" type="button" class="primary">Save</button>
      </div>
    </div>
  </div>`,
);
const settingsOverlay = document.getElementById('settings-overlay')!;
const settingsDialog = document.getElementById('settings-dialog')!;
const settingsSections = document.getElementById('settings-sections')!;
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
const settingsFlagsError = document.getElementById('settings-flags-error')!;
const settingsSaveError = document.getElementById('settings-save-error')!;
const settingsOk = document.getElementById('settings-ok') as HTMLButtonElement;
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement;
const settingsNotes = document.getElementById('settings-notes')!;
const settingsNotesList = document.getElementById('settings-notes-list')!;
const settingsDotsProblems = document.getElementById('settings-dots-problems')!;
const settingsApprovalsProblems = document.getElementById('settings-approvals-problems')!;
const settingsNeedsYouProblems = document.getElementById('settings-needs-you-problems')!;

/**
 * The app's own folders, as Settings lists them: what each holds, where it is, and a button to open it.
 * Both are read-only here — the config folder is edited by hand, the logs are the app's — so a row only says where the folder is.
 * `detail` is the app's own text, never data, which is what makes it safe as markup.
 */
const SETTINGS_FOLDERS: { name: FolderName; label: string; detail: string }[] = [
  {
    name: 'config',
    label: 'Config folder',
    detail: 'Holds <code>settings.json</code>, the settings in every section here; <code>layouts/default.json</code>, which lays out the window and its panels; and the scripts it points at.',
  },
  {
    name: 'logs',
    label: 'Logs',
    detail: `What the app did, to send along when something goes wrong. It keeps the last ${KEEP_LOG_DATES} days it ran plus the ${KEEP_CRASH_LOGS} newest crash logs, and removes older ones itself. Any of them is safe to delete.`,
  },
];

/** One row per folder, in its place in its section (`settings-folder-<name>`), built afresh each time Settings opens, from one shape so the rows cannot drift apart. */
function renderFolderRows(paths: Record<FolderName, string>): void {
  for (const folder of SETTINGS_FOLDERS) document.getElementById(`settings-folder-${folder.name}`)!.replaceChildren(folderRow(folder, paths[folder.name]));
}

/** A folder's row: what it holds, where it is, and its Open. */
function folderRow({ name, label, detail }: (typeof SETTINGS_FOLDERS)[number], path: string): HTMLElement {
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
  where.textContent = path;
  const open = document.createElement('button');
  open.type = 'button';
  open.textContent = 'Open';
  open.addEventListener('click', () => window.claudeUi.openFolder(name));
  row.append(where, open);
  group.append(heading, explanation, row);
  return group;
}

/** The section on show, kept while the app runs and never stored, so Settings opens again where it was left. */
let shown: SectionId = 'general';

const tabOf = (id: SectionId): HTMLElement => document.getElementById(`settings-tab-${id}`)!;
const panelOf = (id: SectionId): HTMLElement => document.getElementById(`settings-section-${id}`)!;

/** Show section `id` and mark its tab, the only one the Tab key stops at. */
function showSection(id: SectionId): void {
  shown = id;
  for (const section of SECTIONS) {
    const on = section.id === id;
    const tab = tabOf(section.id);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    panelOf(section.id).hidden = !on;
  }
}

/** The section that holds the setting `key`. */
const sectionOf = (key: SettingKey): SectionId => SECTIONS.find((section) => section.keys.includes(key))!.id;

/** Show the section holding `key`'s field and put the focus there, for a save refused over it. */
function showField(key: SettingKey, field: HTMLElement): void {
  showSection(sectionOf(key));
  field.focus();
}

settingsSections.addEventListener('click', (event) => {
  const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
  const section = SECTIONS.find(({ id }) => tab?.id === `settings-tab-${id}`);
  if (section !== undefined) showSection(section.id);
});

// The keys a vertical tab list answers: ↑ and ↓ to the one before and after, round at the ends, Home and End to the first and last.
settingsSections.addEventListener('keydown', (event) => {
  const at = SECTIONS.findIndex(({ id }) => id === shown);
  const moves: Partial<Record<string, number>> = { ArrowUp: at - 1, ArrowDown: at + 1, Home: 0, End: SECTIONS.length - 1 };
  const to = moves[event.key];
  if (to === undefined) return;
  event.preventDefault();
  const next = SECTIONS[(to + SECTIONS.length) % SECTIONS.length]!.id;
  showSection(next);
  tabOf(next).focus();
});

settingsDialog.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('.settings-open-config')) window.claudeUi.openFolder('config');
});

showSection(shown);

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

/** What a save sends: every field's value as it stands. */
function currentChange(): Pick<Settings, 'launchFlags' | 'runningSessionsAtLaunch' | 'prStatus' | 'leaveButton' | 'setAside' | 'setAsideTime' | 'locale'> {
  return {
    launchFlags: flagsField.value(),
    runningSessionsAtLaunch: runningField.value(),
    prStatus: prStatusField.value(),
    leaveButton: leaveButtonField.value(),
    setAside: setAsideField.value(),
    setAsideTime: setAsideTimeField.value(),
    locale: localeField.value(),
  };
}

/**
 * Save only while a save would write something, and a mark on each setting it would write and on each section holding one.
 * Both follow the rule the save writes by (`fileChanges`), so an edit put back is no change, and a value of the file's that is not used is one, since saving puts the field's value in its place.
 */
function showPending(view: SettingsView): void {
  const pending = fileChanges(view, currentChange()).map(({ key }) => key);
  settingsOk.disabled = pending.length === 0;
  for (const field of fields) field.showChanged(pending);
  for (const { id, keys } of SECTIONS) tabOf(id).classList.toggle('has-change', keys.some((key) => pending.includes(key)));
}

/** Fill the dialog from the settings as they stand: each setting's field, what is wrong with those set only by hand, a mark on each section holding such a mistake, and under the title what is wrong with the file as a whole. */
function render(view: SettingsView): void {
  for (const field of fields) field.render(view);
  for (const { id, keys } of SECTIONS) tabOf(id).classList.toggle('has-mistake', keys.some((key) => view[key].problem !== null));
  lines(settingsDotsProblems, 'dialog-error', [
    ...(view.strength.problem === null ? [] : [`The order in ${view.file.name} is not used: ${view.strength.problem}`]),
    ...(view.looks.problem === null ? [] : [`The looks in ${view.file.name} are not used: ${view.looks.problem}`]),
  ]);
  lines(settingsApprovalsProblems, 'dialog-error', view.approvals.problem === null ? [] : [`The approvals in ${view.file.name} are not used: ${view.approvals.problem}`]);
  lines(settingsNeedsYouProblems, 'dialog-error', view.needsYou.problem === null ? [] : [`What needsYou in ${view.file.name} changes is not used, so every category and type is as the app ships it: ${view.needsYou.problem}`]);
  lines(settingsNotesList, 'dialog-error', view.notes);
  settingsNotes.hidden = view.notes.length === 0;
  showPending(view);
}

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen of sections.
 * One Save for every section: an edit in one stays while another is on show, and a save refused over a field shows that field's section.
 * Saving is validated by the same parser the launcher uses (shared/flags.ts), so what the field accepts and what a session gets can't disagree.
 * It saves into `settings.json`, writing a setting whose value changed, or whose value in the file is not used (`fileChanges`), so a save that changes nothing leaves a file with no such value as it was.
 */
export async function openSettings(): Promise<void> {
  for (const field of fields) field.reset();
  // Kept as any read of main's is, so a change main tells of that was read before it cannot draw older settings over it.
  keepSettings(await window.claudeUi.getSettings());
  render(store.get().settings!);
  for (const error of [settingsFlagsError, settingsSaveError, settingsSetAsideError, settingsSetAsideTimeError, settingsLocaleError]) error.hidden = true;
  renderFolderRows(await window.claudeUi.getFolders());
  showSection(shown);
  settingsOverlay.hidden = false;
  // The section's first field, ready to type over, or its tab where it has none.
  const first = panelOf(shown).querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
  (first ?? tabOf(shown)).focus();
  if (first instanceof HTMLInputElement && first.type === 'text') first.select();
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a dialog that returns nothing, so `finish()` takes no argument
  await runModal<void>(settingsOverlay, undefined, (finish) => {
    const submit = async (): Promise<void> => {
      // Enter in the flags' field saves too, and like Save does nothing while there is nothing to write.
      if (settingsOk.disabled) return;
      const change = currentChange();
      const { launchFlags, setAside, setAsideTime, locale } = change;
      const { error } = parseLaunchFlags(launchFlags);
      if (error) {
        settingsFlagsError.textContent = error;
        settingsFlagsError.hidden = false;
        showField('launchFlags', settingsFlags);
        return;
      }
      // The setting's own check, so the field refuses what the file would not use.
      const choicesWrong = presetsProblem(setAside);
      settingsSetAsideError.hidden = choicesWrong === null;
      if (choicesWrong !== null) {
        settingsSetAsideError.textContent = choicesWrong;
        showField('setAside', settingsSetAside);
        return;
      }
      settingsSetAsideTimeError.hidden = timeOfDay(setAsideTime) !== null;
      if (!settingsSetAsideTimeError.hidden) {
        settingsSetAsideTimeError.textContent = 'Give a time of day.';
        showField('setAsideTime', settingsSetAsideTime);
        return;
      }
      settingsLocaleError.hidden = languageTag(locale) !== null;
      if (!settingsLocaleError.hidden) {
        settingsLocaleError.textContent = 'Give a language tag such as en-GB, or leave it empty for the system\'s.';
        showField('locale', settingsLocale);
        return;
      }
      const saved = await window.claudeUi.setSettings(change);
      // Main does not tell the window of a change that is all its own write, so the settings as the save left them are kept here.
      keepSettings(saved.view);
      if (saved.refused !== null) {
        render(saved.view);
        settingsSaveError.textContent = saved.refused;
        settingsSaveError.hidden = false;
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
          settingsFlagsError.hidden = true;
          settingsSaveError.hidden = true;
          showPending(store.get().settings!);
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
