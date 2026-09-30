import { listen, runModal } from './modal';

/**
 * The dialog a panel's row opens to start a claude session: which project and group it goes in, its name, and its first prompt.
 * The row fills it in and the person changes it here; nothing starts before Start, so what a panel shared by anyone asks claude to do is always read first.
 * For a row that already started a session, it first offers to continue the latest one, which hides the fields only a new session needs.
 */

// The prompt is worded by askForSession for what happens to it: a new session starts with it, a stopped one resumes with it, and a running one gets none, so there it is hidden.
// The mode choice is only for a row that already has a session: go on in the latest one, or start another.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="session-overlay" class="overlay" hidden>
    <div id="session-dialog" class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="session-title">
      <p id="session-title" class="dialog-title">Start a session</p>
      <p id="session-about" class="dialog-detail"></p>
      <div id="session-mode" class="dialog-section dialog-choices" role="radiogroup" hidden>
        <label class="dialog-choice"><input type="radio" name="session-mode" value="continue" /> <span id="session-continue-label"></span></label>
        <p id="session-continue-note" class="dialog-detail"></p>
        <label class="dialog-choice"><input type="radio" name="session-mode" value="new" /> New session</label>
      </div>
      <div id="session-new">
        <div class="dialog-section">
          <label class="dialog-label" for="session-project">Project</label>
          <select id="session-project" class="dialog-field"></select>
        </div>
        <div class="dialog-section">
          <label class="dialog-label" for="session-group">Group</label>
          <select id="session-group" class="dialog-field"></select>
        </div>
        <div class="dialog-section">
          <label class="dialog-label" for="session-name">Name</label>
          <input id="session-name" class="dialog-field" type="text" spellcheck="false" autocomplete="off" />
        </div>
      </div>
      <div id="session-prompt-section" class="dialog-section">
        <label id="session-prompt-label" class="dialog-label" for="session-prompt">First prompt</label>
        <p id="session-prompt-hint" class="dialog-detail"></p>
        <textarea id="session-prompt" class="dialog-field" rows="3" spellcheck="false"></textarea>
      </div>
      <div class="dialog-actions">
        <button id="session-cancel" type="button">Cancel</button>
        <button id="session-ok" type="button" class="primary">Start</button>
      </div>
    </div>
  </div>`,
);

export interface ProjectChoice {
  root: string;
  name: string;
  groups: { id: string; name: string }[];
}

export interface SessionAsk {
  /** The panel asking, by its title. */
  from: string;
  /** What the row is, in its own words. */
  about: string;
  /** The latest session this row started, when it has one: the dialog offers to go on in it, and does so unless the person picks a new one. */
  continueIn: { title: string; running: boolean } | null;
  projects: ProjectChoice[];
  /** The project shown first, by root; one of `projects`. */
  project: string;
  /** The group shown first in a project, or null for none: the last one picked from this panel there. */
  groupFor(root: string): string | null;
  name: string;
  prompt: string;
}

export interface SessionAnswer {
  /** Go on in the row's latest session, or start a new one where `root` and `groupId` say. */
  mode: 'continue' | 'new';
  root: string;
  groupId: string | null;
  name: string;
  prompt: string;
}


function option(value: string, label: string): HTMLOptionElement {
  const el = document.createElement('option');
  el.value = value;
  el.textContent = label;
  return el;
}

/** Ask where a session goes and what it starts with; null when the person cancels. */
export function askForSession(ask: SessionAsk): Promise<SessionAnswer | null> {
  const overlay = document.getElementById('session-overlay')!;
  const about = document.getElementById('session-about')!;
  const project = document.getElementById('session-project') as HTMLSelectElement;
  const group = document.getElementById('session-group') as HTMLSelectElement;
  const name = document.getElementById('session-name') as HTMLInputElement;
  const prompt = document.getElementById('session-prompt') as HTMLTextAreaElement;
  const ok = document.getElementById('session-ok')!;
  const cancel = document.getElementById('session-cancel')!;
  const modeBox = document.getElementById('session-mode')!;
  const [continueRadio, newRadio] = [...modeBox.querySelectorAll<HTMLInputElement>('input[name="session-mode"]')];
  const continueLabel = document.getElementById('session-continue-label')!;
  const continueNote = document.getElementById('session-continue-note')!;
  const newFields = document.getElementById('session-new')!;
  const promptSection = document.getElementById('session-prompt-section')!;
  const promptLabel = document.getElementById('session-prompt-label')!;
  const promptHint = document.getElementById('session-prompt-hint')!;

  about.textContent = `From ${ask.from}: ${ask.about}`;
  // A row that has a session already goes on in it unless the person says otherwise: that session holds what the first look found.
  modeBox.hidden = ask.continueIn === null;
  if (ask.continueIn) {
    continueLabel.textContent = `Continue in ${ask.continueIn.title}`;
    continueNote.textContent = ask.continueIn.running
      ? 'It is running, so it is brought into view and nothing is sent to it: type there yourself.'
      : 'It is not running, so it is resumed with the prompt below.';
  }
  continueRadio!.checked = ask.continueIn !== null;
  newRadio!.checked = ask.continueIn === null;
  // The prompt is worded for what happens to it: a new session starts with it and a stopped one resumes with it, while a running one gets none, so there it is not shown at all.
  const showMode = (): void => {
    const continuing = continueRadio!.checked;
    newFields.hidden = continuing;
    ok.textContent = continuing ? 'Continue' : 'Start';
    promptSection.hidden = continuing && ask.continueIn?.running === true;
    promptLabel.textContent = continuing ? 'Prompt' : 'First prompt';
    promptHint.textContent = continuing ? 'Sent to claude as the session resumes. Ctrl+Enter continues.' : 'Sent to claude as the session starts. Ctrl+Enter starts it.';
  };
  showMode();
  project.replaceChildren(...ask.projects.map((choice) => option(choice.root, choice.name)));
  project.value = ask.project;
  // A project's own groups, the one last picked from this panel there first; "No group" is always there.
  const fillGroups = (): void => {
    const choice = ask.projects.find((candidate) => candidate.root === project.value);
    group.replaceChildren(option('', 'No group'), ...(choice?.groups ?? []).map((each) => option(each.id, each.name)));
    group.value = ask.groupFor(project.value) ?? '';
  };
  fillGroups();
  name.value = ask.name;
  prompt.value = ask.prompt;

  const promise = runModal<SessionAnswer | null>(overlay, null, (finish) => {
    const submit = (): void => finish({ mode: continueRadio!.checked ? 'continue' : 'new', root: project.value, groupId: group.value || null, name: name.value, prompt: prompt.value });
    return [
      listen(ok, 'click', submit),
      listen(cancel, 'click', () => finish(null)),
      listen(project, 'change', fillGroups),
      listen(continueRadio!, 'change', showMode),
      listen(newRadio!, 'change', showMode),
      // Enter starts from the name, as in the app's other one-line dialogs; the prompt is several lines, so there it is Ctrl+Enter, as in a note.
      listen(name, 'keydown', (event) => {
        if (event.key === 'Enter') submit();
      }),
      listen(prompt, 'keydown', (event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          submit();
        }
      }),
    ];
  });
  // On Start rather than a field: the prompt was written by the panel, and the button is what the person decides with.
  ok.focus();
  return promise;
}
