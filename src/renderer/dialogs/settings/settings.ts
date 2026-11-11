import { parseLaunchFlags } from '../../../shared/config/flags';
import { presetsProblem } from '../../../shared/status/set-aside';
import { timeOfDay } from '../../../shared/helpers/time';
import { changedSettings, fileChanges, languageTag, sameValue, type ChangedSetting, type LeaveButton, type RunningAtLaunch, type SettingsChange, type SettingsView, type UndoRunning } from '../../../shared/config/settings';
import type { Settings } from '../../../shared/types';
import { element } from '../../ui/dom';
import { runModal, listen } from '../../ui/modal';
import { store, type View } from '../../state/app';
import { hideToast, showToast } from '../../ui/toast';
import { panelOf, SECTIONS, settingsDialog, settingsNeedsYouList, showField, showLastSection, showOnlyWhatDiffers, tabOf } from './sections';
import { lines, SettingField } from './field';
import { renderNeedsYouList, renderStrengthList } from './lists';
import { renderFolderRows } from './folders';
import './settings.css';

const settingsOverlay = document.getElementById('settings-overlay')!;
const settingsFlags = document.getElementById('settings-flags') as HTMLInputElement;
const settingsRunning = document.getElementById('settings-running') as HTMLSelectElement;
const settingsPrStatus = document.getElementById('settings-pr-status') as HTMLInputElement;
const settingsLeaveButton = document.getElementById('settings-leave-button') as HTMLSelectElement;
const settingsUndoRunning = document.getElementById('settings-undo-running') as HTMLSelectElement;
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
const settingsStrengthProblems = document.getElementById('settings-strength-problems')!;

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

const undoRunningField = new SettingField(
  'undoRunning',
  {
    element: settingsUndoRunning,
    // Its options are the choices themselves, so what it holds is always one of them.
    read: () => settingsUndoRunning.value as UndoRunning,
    write: (value) => {
      settingsUndoRunning.value = value;
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
const fields = [flagsField, runningField, prStatusField, leaveButtonField, undoRunningField, setAsideField, setAsideTimeField, localeField];

/** What a save sends: every field's value as it stands. */
function currentChange(): Pick<Settings, 'launchFlags' | 'runningSessionsAtLaunch' | 'prStatus' | 'leaveButton' | 'undoRunning' | 'setAside' | 'setAsideTime' | 'locale'> {
  return {
    launchFlags: flagsField.value(),
    runningSessionsAtLaunch: runningField.value(),
    prStatus: prStatusField.value(),
    leaveButton: leaveButtonField.value(),
    undoRunning: undoRunningField.value(),
    setAside: setAsideField.value(),
    setAsideTime: setAsideTimeField.value(),
    locale: localeField.value(),
  };
}

/** The defaults Reset put in place of settings that have no field, such as `approvals` or one id of `needsYou`, saved with Save as an edit is; none once the dialog opens afresh. */
let resets: SettingsChange = {};

/** What a save sends: every field's value as it stands, and what Reset put in place of the settings that have none. */
const pendingChange = (): SettingsChange => ({ ...currentChange(), ...resets });

/**
 * Save only while a save would write something, a mark on each setting it would write and on each section holding one, and each setting's Default line saying whether its Reset is pending.
 * They follow the rule the save writes by (`fileChanges`), so an edit put back is no change, and a value of the file's that is not used is one, since saving puts the field's value in its place.
 */
function showPending(view: SettingsView): void {
  const change = pendingChange();
  const pending = fileChanges(view, change).map(({ key }) => key);
  settingsOk.disabled = pending.length === 0;
  for (const field of fields) field.showChanged(pending);
  for (const { id, keys } of SECTIONS) tabOf(id).classList.toggle('has-change', keys.some((key) => pending.includes(key)));
  renderDefaults(view, change);
}

/** A value as settings.json writes it. */
const written = (value: unknown): string => JSON.stringify(value);

/** Whether `change`, what a save would send, already puts the default in `row`'s place. */
function isReset(row: ChangedSetting, change: SettingsChange): boolean {
  if (row.id !== null) return change.needsYou !== undefined && Object.keys(change.needsYou[row.id] ?? {}).length === 0;
  const sent = change[row.key];
  return sent !== undefined && sameValue(sent, row.fallback);
}

/** Put the default in `row`'s place: in its field where it has one, else among `resets`; `needsYou` one id at a time, the others kept. */
function resetRow(row: ChangedSetting, view: SettingsView): void {
  const field = fields.find((one) => one.key === row.key);
  if (field !== undefined) field.resetToDefault();
  // One id of `needsYou` emptied rather than taken out, so the save edits that entry alone and keeps the comments around it (`fileEdits`).
  else if (row.id !== null) resets = { ...resets, needsYou: { ...(resets.needsYou ?? view.needsYou.value), [row.id]: {} } };
  else resets = { ...resets, [row.key]: row.fallback };
  showPending(view);
}

/** Where `row`'s Default line goes: its row under Needs you for one id of `needsYou`, else under the setting, by its key. */
function defaultHostOf(row: ChangedSetting): HTMLElement {
  if (row.id !== null) return settingsNeedsYouList.querySelector<HTMLElement>(`[data-needs-you-id="${CSS.escape(row.id)}"] > .settings-default`) ?? document.getElementById('settings-needsYou-default')!;
  return document.getElementById(`settings-${row.key}-default`)!;
}

/**
 * Under each setting that differs from the app's default, or whose value in the file is not used, its default and a Reset; none under one at its default.
 * The values are data, so monospace in the text's own colour, which makes the difference the line's content rather than a description of it.
 */
function renderDefaults(view: SettingsView, change: SettingsChange): void {
  for (const host of settingsDialog.querySelectorAll<HTMLElement>('.settings-default')) {
    host.hidden = true;
    host.replaceChildren();
  }
  for (const row of changedSettings(view)) {
    const host = defaultHostOf(row);
    const term = element('span', 'settings-default-term');
    term.textContent = 'Default';
    const value = element(row.fallback === null ? 'span' : 'code', 'settings-default-value');
    value.textContent = row.fallback === null ? 'as the app ships it' : written(row.fallback);
    const reset = element('button', 'settings-reset');
    reset.type = 'button';
    const done = isReset(row, change);
    reset.disabled = done;
    reset.textContent = done ? 'Reset pending' : 'Reset';
    reset.addEventListener('click', () => resetRow(row, store.get().settings ?? view));
    host.append(term, value, reset);
    host.hidden = false;
  }
  showOnlyWhatDiffers(view);
}

/** Fill the dialog from the settings as they stand: each setting's field, what is wrong with those set only by hand, a mark on each section holding such a mistake, and under the title what is wrong with the file as a whole. */
function render(view: SettingsView): void {
  for (const field of fields) field.render(view);
  for (const { id, keys } of SECTIONS) tabOf(id).classList.toggle('has-mistake', keys.some((key) => view[key].problem !== null));
  // Each under its own group, so Only what differs, which shows a group by its setting, never hides one setting's mistake behind the other's.
  lines(settingsDotsProblems, 'dialog-error', view.looks.problem === null ? [] : [`The looks in ${view.file.name} are not used: ${view.looks.problem}`]);
  lines(settingsStrengthProblems, 'dialog-error', view.strength.problem === null ? [] : [`The order in ${view.file.name} is not used: ${view.strength.problem}`]);
  lines(settingsApprovalsProblems, 'dialog-error', view.approvals.problem === null ? [] : [`The approvals in ${view.file.name} are not used: ${view.approvals.problem}`]);
  lines(settingsNeedsYouProblems, 'dialog-error', view.needsYou.problem === null ? [] : [`What needsYou in ${view.file.name} changes is not used, so every category and type is as the app ships it: ${view.needsYou.problem}`]);
  // Main's read applies `needsYou` to what the app ships; the window's own copy stands in for a view made without it.
  const registry = view.needsYouRegistry ?? store.get().needsYouTypes;
  renderNeedsYouList(registry, view.needsYouChanges);
  renderStrengthList(view.strength.value, registry);
  lines(settingsNotesList, 'dialog-error', view.notes);
  settingsNotes.hidden = view.notes.length === 0;
  showPending(view);
}

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen of sections.
 * One Save for every section: an edit in one stays while another is on show, and a save refused over a field shows that field's section.
 * Saving is validated by the same parser the launcher uses (shared/config/flags.ts), so what the field accepts and what a session gets can't disagree.
 * It saves into `settings.json`, writing a setting whose value changed, or whose value in the file is not used (`fileChanges`), so a save that changes nothing leaves a file with no such value as it was.
 */
export async function openSettings(): Promise<void> {
  for (const field of fields) field.reset();
  resets = {};
  // Kept as any read of main's is, so a change main tells of that was read before it cannot draw older settings over it.
  keepSettings(await window.claudeUi.getSettings());
  render(store.get().settings!);
  for (const error of [settingsFlagsError, settingsSaveError, settingsSetAsideError, settingsSetAsideTimeError, settingsLocaleError]) error.hidden = true;
  renderFolderRows(await window.claudeUi.getFolders());
  const shown = showLastSection();
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
      const change = pendingChange();
      const { launchFlags, setAside, setAsideTime, locale } = currentChange();
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
      // Nor of the needs-you categories and types in force a save of `needsYou` changed, so the window takes them from the same answer.
      if (saved.view.needsYouRegistry !== null) store.set({ needsYouTypes: saved.view.needsYouRegistry });
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
