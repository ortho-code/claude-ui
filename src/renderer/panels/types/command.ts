import type { PanelEntry, PanelRunEvent, PanelSource } from '../../../shared/panels';
import { PANEL_TIMEOUT_MS } from '../../../shared/panels';

/**
 * The `command` panel type: runs a command line or a script and shows what it printed.
 *
 * A TYPE DECLARES ITS PARAMETERS ONCE, here. The validator reads this declaration to say what is missing or doubled, the degraded panel words its sentence from the same names, and the editor's form (next slice) will be built from it — so a parameter cannot be known to one of them and not the others.
 */

export type ParamKind = 'text' | 'path';

export interface ParamDecl {
  name: string;
  kind: ParamKind;
  /** For a `path`: what a relative value resolves against. Declared beside the parameter so the resolver is not something the caller has to know. */
  against?: 'config';
}

export interface PanelTypeDecl {
  name: string;
  params: ParamDecl[];
  /** Groups of parameter names of which EXACTLY ONE must be given. */
  exactlyOne: string[][];
  /** The title an entry gets when it names none. Called only on an entry that passed validation. */
  defaultTitle(entry: PanelEntry): string;
}

/** Where a command line is cut for a default title: a title is a label, not the whole line. */
export const TITLE_MAX = 40;

/**
 * Two ways to say what runs, exactly one required.
 * The type keeps the name `command` although a `script` is not a command line, because a one-liner is not a script either and Claude Code's own statusline and hooks are `"type": "command"` for both.
 */
export const commandType: PanelTypeDecl = {
  name: 'command',
  params: [
    { name: 'command', kind: 'text' },
    { name: 'script', kind: 'path', against: 'config' },
  ],
  exactlyOne: [['command', 'script']],
  defaultTitle: (entry) => {
    if (typeof entry.script === 'string') return entry.script.split('/').filter(Boolean).at(-1) ?? entry.script;
    const line = (entry.command ?? '').trim();
    return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
  },
};

/** What an entry runs, in the form the runner takes. Only for an entry that passed validation, which is what guarantees exactly one is present. */
export function commandSource(entry: PanelEntry): PanelSource {
  return typeof entry.script === 'string' ? { script: entry.script } : { command: entry.command ?? '' };
}

/** Shown in the empty-pane style when there is neither a tab nor a project to run in. */
export const NO_CONTEXT = 'Pick a project to run this in.';

/**
 * The header's word on a run that has ended, or '' for one that ended well.
 * One place for the wording, so the panel's header and anything that later quotes it (a tooltip, a strip) agree.
 */
export function endLabel(event: PanelRunEvent): string {
  switch (event.kind) {
    case 'exit':
      if (event.error) return event.error;
      if (event.code === 0) return '';
      return event.code === null ? `killed by ${event.signal ?? 'a signal'}` : `exit ${event.code}`;
    case 'stopped':
      switch (event.reason) {
        case 'timeout':
          return `stopped after ${PANEL_TIMEOUT_MS / 1000} s`;
        case 'truncated':
          return 'output cut at 1 MB';
        default:
          return 'stopped';
      }
    default:
      return '';
  }
}
