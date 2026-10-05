import { parseLaunchFlags } from '../shared/flags';
import type { FolderName } from '../shared/folders';
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES } from '../shared/log';
import { listen, runModal } from './modal';

// App preferences.
// One section for now; the shape is per-section so a second one (a read-only view of the user's own Claude config) is an addition rather than a rework.
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

/**
 * The app's own folders, as Settings lists them: what each holds, where it is, and a button to open it.
 * Both are read-only here — the config folder is edited by hand, the logs are the app's — so a row only says where the folder is.
 * `detail` is the app's own text, never data, which is what makes it safe as markup.
 */
const SETTINGS_FOLDERS: { name: FolderName; label: string; detail: string }[] = [
  {
    name: 'config',
    label: 'Config folder',
    detail: 'Holds <code>layouts/default.json</code>, which lays out the window and its panels, and the scripts it points at.',
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

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other two dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen that will grow sections.
 * Saving is validated by the same parser the launcher uses (shared/flags.ts), so what the field accepts and what a session gets can't disagree.
 */
export async function openSettings(): Promise<void> {
  const stored = await window.claudeUi.getSettings();
  settingsFlags.value = stored.launchFlags;
  settingsError.hidden = true;
  renderFolderRows(await window.claudeUi.getFolders());
  settingsOverlay.hidden = false;
  settingsFlags.focus();
  settingsFlags.select();
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- a dialog that returns nothing, so `finish()` takes no argument
  await runModal<void>(settingsOverlay, undefined, (finish) => {
    const submit = async (): Promise<void> => {
      const value = settingsFlags.value.trim();
      const { error } = parseLaunchFlags(value);
      if (error) {
        settingsError.textContent = error;
        settingsError.hidden = false;
        return;
      }
      await window.claudeUi.setSettings({ ...stored, launchFlags: value });
      finish();
    };
    return [
      listen(settingsOk, 'click', () => void submit()),
      listen(settingsCancel, 'click', () => finish()),
      listen(settingsFlags, 'keydown', (event) => {
        if (event.key === 'Enter') void submit();
      }),
      // Typing is the fix for an error, so clear it as soon as they do rather than leaving a stale complaint under the field.
      listen(settingsFlags, 'input', () => {
        settingsError.hidden = true;
      }),
    ];
  });
}
