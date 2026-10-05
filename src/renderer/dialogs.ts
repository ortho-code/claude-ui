import { listen, runModal } from './modal';
import './dialogs.css';

// The two dialogs any part of the window asks with: a confirm before a delete, and a line or a note of text.
document.body.insertAdjacentHTML(
  'beforeend',
  `<div id="confirm-overlay" class="overlay" hidden>
    <div id="confirm-dialog" class="dialog" role="dialog" aria-modal="true">
      <p id="confirm-message" class="dialog-title"></p>
      <p id="confirm-detail" class="dialog-detail"></p>
      <div id="confirm-actions" class="dialog-actions">
        <button id="confirm-cancel" type="button">Cancel</button>
        <button id="confirm-ok" type="button" class="danger">Delete</button>
      </div>
    </div>
  </div>
  <div id="rename-overlay" class="overlay" hidden>
    <div id="rename-dialog" class="dialog" role="dialog" aria-modal="true">
      <p id="rename-title" class="dialog-title">Rename project</p>
      <p id="rename-path" class="dialog-detail"></p>
      <input id="rename-input" class="dialog-field" type="text" aria-label="Project name" />
      <textarea id="rename-textarea" class="dialog-field" rows="6" aria-label="Note" hidden></textarea>
      <p id="rename-error" class="dialog-error" hidden></p>
      <div id="rename-actions" class="dialog-actions">
        <button id="rename-cancel" type="button">Cancel</button>
        <button id="rename-ok" type="button" class="primary">Save</button>
      </div>
    </div>
  </div>`,
);
const confirmOverlay = document.getElementById('confirm-overlay')!;
const confirmMessage = document.getElementById('confirm-message')!;
const confirmDetail = document.getElementById('confirm-detail')!;
const confirmOk = document.getElementById('confirm-ok') as HTMLButtonElement;
const confirmCancel = document.getElementById('confirm-cancel') as HTMLButtonElement;
const renameOverlay = document.getElementById('rename-overlay')!;
const renameTitle = document.getElementById('rename-title')!;
const renamePath = document.getElementById('rename-path')!;
const renameError = document.getElementById('rename-error')!;
const renameInput = document.getElementById('rename-input') as HTMLInputElement;
const renameTextarea = document.getElementById('rename-textarea') as HTMLTextAreaElement;
const renameOk = document.getElementById('rename-ok') as HTMLButtonElement;
const renameCancel = document.getElementById('rename-cancel') as HTMLButtonElement;

// In-app confirm modal (a native dialog flickers under WSLg), run by modal.ts like every modal here.
// Resolves true on Delete, false on Cancel / Esc.
// Deliberately NOT dismissable by clicking the backdrop: selecting text inside the dialog and releasing the mouse outside it dispatches the click on the common ancestor of the mousedown and mouseup — the overlay — so an outside-click dismiss threw the dialog away mid-drag.

export function confirmDelete(title: string): Promise<boolean> {
  confirmMessage.textContent = `Delete "${title}"?`;
  confirmDetail.textContent = 'Its transcript files move to the trash, so you can restore them from there if needed.';
  // Focus Cancel, not Delete: safer default for a destructive action, and it keeps the accent focus ring off the red button.
  confirmCancel.focus();
  return runModal<boolean>(confirmOverlay, false, (finish) => [
    listen(confirmOk, 'click', () => finish(true)),
    listen(confirmCancel, 'click', () => finish(false)),
  ]);
}

// A small modal text prompt (Promise-resolving): OK/Enter resolves the value, Cancel/Esc resolves null.
// Shared by project rename, fork naming, and worktree naming; okLabel names the confirm button.
// An optional async `validate` runs on submit: return an error string to show it inline and keep the dialog open (so the user can fix the value), or null to accept.
export function promptText(
  title: string,
  context: string,
  initialValue: string,
  okLabel = 'Save',
  validate?: (value: string) => Promise<string | null> | string | null,
  // Multiline swaps the single-line input for a textarea (session notes).
  // Same dialog, same skin — only the field and what Enter means differ.
  multiline = false,
): Promise<string | null> {
  renameTitle.textContent = title;
  renamePath.textContent = context;
  renamePath.hidden = !context; // no empty context line (e.g. the fork dialog puts it in the title)
  renameError.hidden = true;
  renameOk.textContent = okLabel;
  const field: HTMLInputElement | HTMLTextAreaElement = multiline ? renameTextarea : renameInput;
  // A union of input|textarea loses addEventListener's keyed overloads (the handler would widen to Event), so listeners go through the element as an HTMLElement while `field` keeps .value typed.
  const fieldEl: HTMLElement = field;
  renameInput.hidden = multiline;
  renameTextarea.hidden = !multiline;
  field.value = initialValue;
  // Shown by runModal; focus has to wait for that, since a hidden field cannot take it.
  renameOverlay.hidden = false;
  field.focus();
  // Select-all suits a short name you're replacing; a note you're editing wants the caret at the end.
  if (multiline) field.setSelectionRange(initialValue.length, initialValue.length);
  else field.select();
  return runModal<string | null>(renameOverlay, null, (finish) => {
    // Validate before accepting; on an error, show it inline and leave the dialog open.
    const submit = async (): Promise<void> => {
      const value = field.value;
      if (validate) {
        const error = await validate(value);
        if (error) {
          renameError.textContent = error;
          renameError.hidden = false;
          return;
        }
      }
      finish(value);
    };
    return [
      listen(renameOk, 'click', () => void submit()),
      listen(renameCancel, 'click', () => finish(null)),
      // Enter belongs to the field, since it submits what you typed; Escape is the modal's own and lives in runModal.
      // In a note Enter is a newline and Ctrl/Cmd+Enter saves, the same habit as the terminal; a one-line field submits on plain Enter.
      listen(fieldEl, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        if (!multiline) void submit();
        else if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          void submit();
        }
      }),
    ];
  });
}
