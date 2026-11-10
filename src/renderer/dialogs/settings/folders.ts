import type { FolderName } from '../../../shared/helpers/folders';
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES } from '../../../shared/helpers/log';

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
export function renderFolderRows(paths: Record<FolderName, string>): void {
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
