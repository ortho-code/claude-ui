import { listen, runModal } from './modal';

/**
 * The dialog a panel's row opens to start a claude session: which project and group it goes in, its name, and its first prompt.
 * The row fills it in and the person changes it here; nothing starts before Start, so what a panel shared by anyone asks claude to do is always read first.
 */

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
  projects: ProjectChoice[];
  /** The project shown first, by root; one of `projects`. */
  project: string;
  /** The group shown first in a project, or null for none: the last one picked from this panel there. */
  groupFor(root: string): string | null;
  name: string;
  prompt: string;
}

export interface SessionAnswer {
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

  about.textContent = `From ${ask.from}: ${ask.about}`;
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
    const submit = (): void => finish({ root: project.value, groupId: group.value || null, name: name.value, prompt: prompt.value });
    return [
      listen(ok, 'click', submit),
      listen(cancel, 'click', () => finish(null)),
      listen(project, 'change', fillGroups),
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
