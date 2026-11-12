import { defaultSettings } from '../../shared/config/defaults';
import { presetMoment, presetWords, setAsideOffers, type Preset } from '../../shared/status/set-aside';
import { dayStart, onDayAt, timeOfDay } from '../../shared/helpers/time';
import type { SetAside } from '../../shared/types';
import { calendar } from './calendar';
import { setAsideUntil } from '../status/state-lines';
import { momentInLanguage } from '../ui/locale';
import { listen, runModal } from '../ui/modal';
import { store } from '../state/app';
import '../ui/pill.css';
import './set-aside-dialog.css';

/**
 * SET ASIDE…: the one dialog that sets sessions aside, from a session's menu and from the bar of selecting several (docs/architecture/status-cues.md § Status cues).
 * When to come back, from the settings' choices (`setAside`, shared/status/set-aside.ts) in the order they would come, then Pick a date… and Whenever; and where it stands, which is the session's note (decided 2026-11-05), so the line is there to read when the session comes back, after its mark has gone.
 */

document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="set-aside-overlay" class="overlay" hidden>
    <div id="set-aside-dialog" class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="set-aside-title">
      <p id="set-aside-title" class="dialog-title"></p>
      <p id="set-aside-now" class="dialog-detail"></p>
      <div class="dialog-group">
        <span id="set-aside-when" class="dialog-label">When to come back</span>
        <div id="set-aside-choices" role="group" aria-labelledby="set-aside-when"></div>
        <div id="set-aside-pick" hidden>
          <div id="set-aside-calendar"></div>
          <input id="set-aside-time" class="dialog-field" type="time" aria-label="Time" />
        </div>
      </div>
      <div class="dialog-group">
        <label id="set-aside-where" class="dialog-label" for="set-aside-note">Where it stands</label>
        <textarea id="set-aside-note" class="dialog-field note-field" rows="4"></textarea>
        <p id="set-aside-notes-stay" class="dialog-detail">Their notes stay as they are.</p>
      </div>
      <div class="dialog-actions">
        <button id="set-aside-cancel" type="button">Cancel</button>
        <button id="set-aside-ok" type="button" class="primary" disabled>Set aside</button>
      </div>
    </div>
  </div>`,
);
const overlay = document.getElementById('set-aside-overlay')!;
const title = document.getElementById('set-aside-title')!;
const standing = document.getElementById('set-aside-now')!;
const choices = document.getElementById('set-aside-choices')!;
const pick = document.getElementById('set-aside-pick')!;
const time = document.getElementById('set-aside-time') as HTMLInputElement;
const note = document.getElementById('set-aside-note') as HTMLTextAreaElement;
const notesStay = document.getElementById('set-aside-notes-stay')!;
const ok = document.getElementById('set-aside-ok') as HTMLButtonElement;
const cancel = document.getElementById('set-aside-cancel') as HTMLButtonElement;

/** What is chosen: a preset, worked out again at the press, Pick a date…, or nothing yet. */
let chosen: Preset | 'pick' | null = null;
let pickedDay: Date | null = null;

const dayPicker = calendar(document.getElementById('set-aside-calendar')!, {
  onSelect: ({ date }) => {
    pickedDay = date instanceof Date ? date : null;
    fillOk();
  },
});
time.addEventListener('input', fillOk);

/** Set aside while a choice is made, and with Pick a date… a day picked and a time that reads. */
function fillOk(): void {
  ok.disabled = chosen === null || (chosen === 'pick' && (pickedDay === null || timeOfDay(time.value) === null));
}

/** What the dialog sets aside: what its title names, the one session's mark as it stands, and its note; null for several, whose notes it leaves alone (decided 2026-11-05). */
export interface SetAsideTarget {
  what: string;
  mark: SetAside | undefined;
  note: string | null;
}

/** What Set aside answered: the moment it comes back, null for whenever, and the line as it was left, null where the dialog had none. */
export interface SetAsideAnswer {
  due: number | null;
  note: string | null;
}

/**
 * Ask when to come back and where it stands; the answer on Set aside or Ctrl+Enter, null on Cancel or Esc.
 * The choices are named by their moments as the dialog opens, and a preset's moment is worked out again at the press, so "in 2h" counts from it; nothing is chosen at the start, an existing mark included, so Set aside always means a choice made here.
 */
export function setAsideDialog(target: SetAsideTarget): Promise<SetAsideAnswer | null> {
  const settings = store.get().settings;
  const presets = settings?.setAside.value ?? defaultSettings().setAside;
  // A choice without its own time comes back at the time of day the settings say (decided 2026-10-29).
  const timeOfChoice = settings?.setAsideTime.value ?? defaultSettings().setAsideTime;
  const opened = Date.now();
  title.textContent = `Set aside: ${target.what}`;
  // Already set aside, it says until when, and Set aside replaces that mark.
  standing.textContent = target.mark ? `Now set aside${setAsideUntil(target.mark.due)}.` : '';
  standing.hidden = !target.mark;
  chosen = null;
  pickedDay = null;
  pick.hidden = true;
  time.value = timeOfChoice;
  dayPicker.clear({ silent: true });
  // Pick a date… starts tomorrow: a time later today is what a preset such as "in 2h" is for.
  const earliest = new Date(dayStart(opened, 1));
  dayPicker.update({ minDate: earliest });
  dayPicker.setViewDate(earliest);
  // Dated choices first, then Pick a date…, and Whenever last where the settings have it, so a day is what comes to hand first, since an undated mark brings nothing back by itself (decided 2026-10-29).
  const offers = setAsideOffers(presets, opened, timeOfChoice);
  const buttons: [HTMLButtonElement, Preset | 'pick'][] = [
    ...offers.filter((offer) => offer.due !== null).map(({ preset, due }) => [choiceButton(`${presetWords(preset)} (${momentInLanguage(due!)})`), preset] as [HTMLButtonElement, Preset]),
    [choiceButton('Pick a date…'), 'pick'],
    ...offers.filter((offer) => offer.due === null).map(({ preset }) => [choiceButton(presetWords(preset)), preset] as [HTMLButtonElement, Preset]),
  ];
  choices.replaceChildren(...buttons.map(([button]) => button));
  const withNote = target.note !== null;
  note.hidden = !withNote;
  notesStay.hidden = withNote;
  note.value = target.note ?? '';
  fillOk();
  overlay.hidden = false;
  // The line takes the keys, its caret at the end, as Edit note… has it; without one, the first choice.
  if (withNote) {
    note.focus();
    note.setSelectionRange(note.value.length, note.value.length);
  } else buttons[0]![0].focus();
  return runModal<SetAsideAnswer | null>(overlay, null, (finish) => {
    const submit = (): void => {
      if (ok.disabled || chosen === null) return;
      const due = chosen === 'pick' ? onDayAt(pickedDay!.getTime(), time.value) : presetMoment(chosen, Date.now(), timeOfChoice);
      finish({ due, note: withNote ? note.value : null });
    };
    return [
      ...buttons.map(([button, choice]) =>
        listen(button, 'click', () => {
          chosen = choice;
          for (const [other] of buttons) {
            other.classList.toggle('active', other === button);
            other.setAttribute('aria-pressed', String(other === button));
          }
          pick.hidden = choice !== 'pick';
          fillOk();
        }),
      ),
      listen(ok, 'click', submit),
      listen(cancel, 'click', () => finish(null)),
      // Ctrl/Cmd+Enter sets aside from anywhere in the dialog, as it saves a note; a plain Enter is the line's newline.
      listen(overlay, 'keydown', (event) => {
        if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        event.preventDefault();
        submit();
      }),
    ];
  });
}

function choiceButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', 'false');
  return button;
}
