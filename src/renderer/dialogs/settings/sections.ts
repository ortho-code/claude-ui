import { changedSettings, LEAVE_BUTTON, RUNNING_AT_LAUNCH, SET_ASIDE_NEWS, SET_ASIDE_RUNNING, UNDO_RUNNING, type LeaveButton, type RunningAtLaunch, type SetAsideNews, type SetAsideRunning, type SettingKey, type SettingsView, type UndoRunning } from '../../../shared/config/settings';
import { store } from '../../state/app';
// The section list's entries are menu rows.
import '../../ui/menu-row.css';

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

/** Each choice for a running tab an Undo brings back, in words: the dropdown's options. */
const UNDO_RUNNING_LABELS: Record<UndoRunning, string> = {
  start: 'Start claude again',
  cold: 'Bring the tab back without starting it',
};

/** Each choice for a running session set aside, in words: the dropdown's options. */
const SET_ASIDE_RUNNING_LABELS: Record<SetAsideRunning, string> = {
  'stop-close': 'Stop claude and close the tab',
  stop: 'Stop claude, keep the tab',
  keep: 'Keep claude running',
};

/** Each choice for news on a set-aside session, in words: the dropdown's options. */
const SET_ASIDE_NEWS_LABELS: Record<SetAsideNews, string> = {
  show: 'Show it now',
  wait: 'Wait for its day',
};

type SectionId = 'general' | 'sessions' | 'needs-you' | 'appearance' | 'version-control' | 'logs';

/** Each setting's words. */
const SETTING_LABELS: Record<SettingKey, string> = {
  launchFlags: 'Default launch flags',
  runningSessionsAtLaunch: 'Sessions running when the app closed',
  prStatus: 'PR status from GitHub',
  leaveButton: 'Leave button',
  undoRunning: 'When Undo brings back a tab whose claude was running',
  setAsideRunning: 'When a running session is set aside',
  setAsideNews: 'News while set aside',
  setAside: 'Set aside: the choices',
  setAsideTime: 'Time of day for a choice without one',
  locale: 'Language for times and dates',
  strength: 'The order, first wins',
  looks: 'Status dots: the looks',
  needsYou: 'What can mark a session',
  approvals: 'Approvals',
};

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
export const SECTIONS: Section[] = [
  {
    id: 'general',
    label: 'General',
    keys: ['launchFlags', 'locale', 'runningSessionsAtLaunch'],
    body: `
      <div class="dialog-group">
        <label class="dialog-label" for="settings-flags">${SETTING_LABELS.launchFlags}</label>
        <p class="dialog-detail">Added to every session started from now on. Sessions already running keep the flags they started with.</p>
        <input id="settings-flags" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="--allowedTools Grep,Glob" />
        <p id="settings-flags-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-locale">${SETTING_LABELS.locale}</label>
        <p class="dialog-detail">A language tag such as en-GB or nl-NL, or empty for the system's. Time fields follow this from the next launch; the rest of the app at once.</p>
        <input id="settings-locale" class="dialog-field" type="text" spellcheck="false" autocomplete="off" />
        <p id="settings-locale-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-running">${SETTING_LABELS.runningSessionsAtLaunch}</label>
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
    keys: ['leaveButton', 'undoRunning', 'setAsideRunning', 'setAsideNews', 'setAside', 'setAsideTime'],
    body: `
      <div class="dialog-group">
        <label class="dialog-label" for="settings-leave-button">${SETTING_LABELS.leaveButton}</label>
        <p class="dialog-detail">The button beside a session's menu on its tab, which a middle-click on the tab presses too. A running session is asked to leave first, whichever it is. Without the button, the session's menu holds it all.</p>
        <select id="settings-leave-button" class="dialog-field">
          ${LEAVE_BUTTON.map((choice) => `<option value="${choice}">${LEAVE_BUTTON_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-undo-running">${SETTING_LABELS.undoRunning}</label>
        <p class="dialog-detail">The Undo a close or a finish offers puts its tabs back where they were. This is for a tab whose claude the close or the finish ended; any other comes back cold either way.</p>
        <select id="settings-undo-running" class="dialog-field">
          ${UNDO_RUNNING.map((choice) => `<option value="${choice}">${UNDO_RUNNING_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside-running">${SETTING_LABELS.setAsideRunning}</label>
        <p class="dialog-detail">A prompt you send in a session set aside takes the mark off, so stopping claude keeps a reply from doing that by accident. A busy claude is interrupted, as Stop does. The message that follows has an Undo that puts it all back.</p>
        <select id="settings-set-aside-running" class="dialog-field">
          ${SET_ASIDE_RUNNING.map((choice) => `<option value="${choice}">${SET_ASIDE_RUNNING_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside-news">${SETTING_LABELS.setAsideNews}</label>
        <p class="dialog-detail">Something that needs you after you set a session aside, such as a change on its PR. Waiting, it stays dimmed and uncounted until the day comes, or with whenever until the mark goes. Claude's own status shows either way, and a prompt you send there takes the mark off.</p>
        <select id="settings-set-aside-news" class="dialog-field">
          ${SET_ASIDE_NEWS.map((choice) => `<option value="${choice}">${SET_ASIDE_NEWS_LABELS[choice]}</option>`).join('')}
        </select>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside">${SETTING_LABELS.setAside}</label>
        <p class="dialog-detail">Separated by commas, offered in the order they come, with Pick a date… beside them and whenever last: whenever, in 30m, in 2h, in 3d, in 1w, tomorrow or next monday, a day with a time such as 09:00 or else the time below.</p>
        <input id="settings-set-aside" class="dialog-field" type="text" spellcheck="false" autocomplete="off" placeholder="tomorrow, in 1w, whenever" />
        <p id="settings-set-aside-error" class="dialog-error" hidden></p>
      </div>
      <div class="dialog-group">
        <label class="dialog-label" for="settings-set-aside-time">${SETTING_LABELS.setAsideTime}</label>
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
      <div class="dialog-group" data-setting="needsYou">
        <span class="dialog-label">${SETTING_LABELS.needsYou}</span>
        <p class="dialog-detail">Which reasons mark a session as needing you is <code>needsYou</code> in settings.json, set there by hand: by a type's or a category's id, the fields it changes, such as <code>"needsYou": { "pr.merged": { "enabled": false } }</code> to be marked no more when a PR is merged.</p>
        ${OPEN_CONFIG}
        <div id="settings-needs-you-problems"></div>
        <div id="settings-needsYou-default" class="settings-default" hidden></div>
      </div>
      <div id="settings-needs-you-list" class="settings-list"></div>`,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    keys: ['strength', 'looks'],
    body: `
      <div class="dialog-group" data-setting="looks">
        <span class="dialog-label">Status dots</span>
        <p class="dialog-detail">Which state a session's dot shows when several hold, such as busy and needing you, is <code>strength</code> in settings.json, and how each status, category and type is drawn is <code>looks</code>, both set there by hand.</p>
        ${OPEN_CONFIG}
        <div id="settings-dots-problems"></div>
        <div id="settings-looks-default" class="settings-default" hidden></div>
      </div>
      <div class="dialog-group" data-setting="strength">
        <span class="dialog-label">${SETTING_LABELS.strength}</span>
        <p class="dialog-detail">A dot shows the first of these that holds, each drawn in its look; a type's own look is beside it under Needs you.</p>
        <ol id="settings-strength-list" class="settings-list"></ol>
        <div id="settings-strength-problems"></div>
        <div id="settings-strength-default" class="settings-default" hidden></div>
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
          <label id="settings-pr-status-row" class="dialog-choice"><input id="settings-pr-status" class="settings-switch" type="checkbox" role="switch" /> ${SETTING_LABELS.prStatus}</label>
        </div>
        <div class="dialog-group" data-setting="approvals">
          <span class="dialog-label">${SETTING_LABELS.approvals}</span>
          <p class="dialog-detail">How many approvals a repository's PRs need before they count as approved is <code>approvals</code> in settings.json, set there by hand; a repository it does not name counts as approved when GitHub says so.</p>
          ${OPEN_CONFIG}
          <div id="settings-approvals-problems"></div>
          <div id="settings-approvals-default" class="settings-default" hidden></div>
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

// App preferences, from the config folder: settings.json, which you edit and this dialog saves into (shared/config/settings.ts), said once under the title.
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
        <div class="settings-nav">
          <div id="settings-sections" role="tablist" aria-orientation="vertical" aria-label="Sections">
            ${SECTIONS.map(({ id, label }) => `<button type="button" id="settings-tab-${id}" class="menu-row settings-tab" role="tab" aria-label="${label}" aria-controls="settings-section-${id}">${label}<span class="settings-count"></span></button>`).join('')}
          </div>
          <label class="dialog-choice settings-only-differs"><input id="settings-only-differs" class="settings-switch" type="checkbox" role="switch" /> Only what differs</label>
        </div>
        ${SECTIONS.map(({ id, label, body }) => `<section id="settings-section-${id}" class="settings-section" role="tabpanel" aria-labelledby="settings-tab-${id}" hidden><h2 class="settings-heading">${label}</h2><p class="dialog-detail settings-hint" hidden></p>${body}</section>`).join('')}
      </div>
      <p id="settings-save-error" class="dialog-error" hidden></p>
      <div class="dialog-actions">
        <button id="settings-cancel" type="button">Cancel</button>
        <button id="settings-ok" type="button" class="primary">Save</button>
      </div>
    </div>
  </div>`,
);
export const settingsDialog = document.getElementById('settings-dialog')!;
export const settingsNeedsYouList = document.getElementById('settings-needs-you-list')!;
const settingsSections = document.getElementById('settings-sections')!;
const settingsOnlyDiffers = document.getElementById('settings-only-differs') as HTMLInputElement;

/** The section on show, kept while the app runs and never stored, so Settings opens again where it was left. */
let shown: SectionId = 'general';

export const tabOf = (id: SectionId): HTMLElement => document.getElementById(`settings-tab-${id}`)!;
export const panelOf = (id: SectionId): HTMLElement => document.getElementById(`settings-section-${id}`)!;

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

/** Show the section last on show again, and give its id. */
export function showLastSection(): SectionId {
  showSection(shown);
  return shown;
}

/** The section that holds the setting `key`. */
const sectionOf = (key: SettingKey): SectionId => SECTIONS.find((section) => section.keys.includes(key))!.id;

/** Show the section holding `key`'s field and put the focus there, for a save refused over it. */
export function showField(key: SettingKey, field: HTMLElement): void {
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

/**
 * With "Only what differs" on, each section shows only its settings that differ from the default, the list counts them per section and dims a section with none, and a line under the heading says so; off, everything shows.
 * Kept while the app runs, as the section on show is, and never stored.
 */
export function showOnlyWhatDiffers(view: SettingsView): void {
  const only = settingsOnlyDiffers.checked;
  const rows = changedSettings(view);
  const keys = new Set(rows.map((row) => row.key));
  const ids = new Set(rows.flatMap((row) => (row.id === null ? [] : [row.id])));
  for (const group of settingsDialog.querySelectorAll<HTMLElement>('.settings-section [data-setting]')) group.hidden = only && !keys.has(group.dataset.setting as SettingKey);
  for (const row of settingsNeedsYouList.querySelectorAll<HTMLElement>('[data-needs-you-id]')) row.hidden = only && !ids.has(row.dataset.needsYouId!);
  // A category shows with any of its types that does, its own row heading them, as it does unfiltered.
  for (const block of settingsNeedsYouList.querySelectorAll<HTMLElement>('.settings-category')) {
    const shown = block.querySelector('[data-needs-you-id]:not([hidden])') !== null;
    block.querySelector<HTMLElement>('.settings-category-row')!.hidden = only && !shown;
    block.hidden = only && !shown;
  }
  for (const section of SECTIONS) {
    const count = rows.filter((row) => section.keys.includes(row.key)).length;
    const panel = panelOf(section.id);
    // What holds no setting of its own, such as a folder's row or a part's heading, shows while anything in it does.
    for (const child of panel.children) {
      if (!(child instanceof HTMLElement) || child.matches('.settings-heading, .settings-hint, [data-setting]')) continue;
      child.hidden = only && child.querySelector('[data-setting]:not([hidden]), [data-needs-you-id]:not([hidden])') === null;
    }
    const hint = panel.querySelector<HTMLElement>('.settings-hint')!;
    hint.hidden = !only;
    hint.textContent = count === 0 ? 'Nothing here differs from the defaults.' : `Showing the ${count === 1 ? 'setting' : `${count} settings`} here that ${count === 1 ? 'differs' : 'differ'} from the defaults; switch off Only what differs to see them all.`;
    const tab = tabOf(section.id);
    tab.querySelector('.settings-count')!.textContent = only && count > 0 ? String(count) : '';
    tab.classList.toggle('dimmed', only && count === 0);
  }
}

settingsOnlyDiffers.addEventListener('change', () => {
  const view = store.get().settings;
  if (view !== null) showOnlyWhatDiffers(view);
});
