import { expandedStrength, NEEDS_YOU, YOUR_TURN_STATUS } from '../../../shared/status/looks';
import type { NeedsYouRegistry } from '../../../shared/status/needsyou';
import { PR_ROLES } from '../../../shared/sessions/prs';
import type { PrRole } from '../../../shared/types';
import { element } from '../../ui/dom';
import { statusLabel } from '../../status/statelines';
import { stateClass } from '../../status/statusdot';
import { settingsNeedsYouList } from './sections';

const settingsStrengthList = document.getElementById('settings-strength-list')!;

/** The words for the roles a PR's type fires for. */
const ROLE_WORDS: Record<PrRole, string> = { own: 'your own PRs', reviewing: 'PRs you review', other: "anyone else's" };

/** A dot drawn as a session's dot showing `state` is, in its look (`stateClass`). */
const dotFor = (state: string): HTMLElement => element('span', `nudge single ${stateClass(state)}`);

/** A row of the read-only lists: a dot, a name, its id where it has one, and short lines after it, such as "off". */
function listRow(className: string, state: string, name: string, id: string | null, tags: string[]): HTMLElement {
  const row = element('div', `settings-row ${className}`);
  const label = element('span', 'settings-row-name');
  label.textContent = name;
  row.append(dotFor(state), label);
  if (id !== null) {
    const code = element('code', 'settings-row-id');
    code.textContent = id;
    row.append(code);
  }
  for (const tag of tags) {
    const line = element('span', `settings-tag${tag.startsWith('changed') ? ' changed' : ''}`);
    line.textContent = tag;
    row.append(line);
  }
  return row;
}

/** What `needsYou` changes of one id from what the app ships, as a line: "changed: enabled, roles"; none for an id it leaves alone or names to no effect. */
const changedLine = (changes: Readonly<Record<string, string[]>>, id: string): string[] => {
  const fields = changes[id] ?? [];
  return fields.length === 0 ? [] : [`changed: ${fields.join(', ')}`];
};

/**
 * The needs-you categories in force, in Now's order, each with its types: what can mark a session, which are off, and what `needsYou` changed.
 * Your turn's types are drawn as the statuses they are, since claude's status shows them.
 */
export function renderNeedsYouList(registry: NeedsYouRegistry, changes: Readonly<Record<string, string[]>>): void {
  // A row of an id `needsYou` can change: found by it, for its own Default line and for "Only what differs".
  const byId = (row: HTMLElement, id: string): HTMLElement => {
    row.dataset.needsYouId = id;
    const host = element('span', 'settings-default');
    host.hidden = true;
    row.append(host);
    return row;
  };
  settingsNeedsYouList.replaceChildren(
    ...registry.categories.map((category) => {
      const block = element('div', 'settings-category');
      block.append(byId(listRow('settings-category-row', `needs:${category.id}`, category.label, category.id, [...(category.enabled ? [] : ['off']), ...changedLine(changes, category.id)]), category.id));
      for (const type of registry.types.filter((t) => t.category === category.id)) {
        const status = YOUR_TURN_STATUS[type.id];
        const roles = type.roles === null || type.roles.length === PR_ROLES.length ? [] : [`for ${type.roles.map((role) => ROLE_WORDS[role]).join(', ')}`];
        const drawn = status === undefined ? [] : ["claude's status"];
        block.append(byId(listRow('settings-type-row', status ?? `needs:${type.id}`, type.label, type.id, [...(type.enabled ? [] : ['off']), ...roles, ...drawn, ...changedLine(changes, type.id)]), type.id));
      }
      return block;
    }),
  );
}

/** The strength order in force, top to bottom, `needs-you` opened into the categories it stands for, each in its look. */
export function renderStrengthList(order: readonly string[], registry: NeedsYouRegistry): void {
  const categories = new Map(registry.categories.map((category) => [category.id, category.label]));
  settingsStrengthList.replaceChildren(
    ...expandedStrength(order, registry).map((entry) => {
      const item = element('li');
      const category = categories.get(entry);
      if (entry === NEEDS_YOU) item.append(listRow('settings-strength-row', 'needs', 'Needs you, any other reason', null, []));
      else if (category !== undefined) item.append(listRow('settings-strength-row', `needs:${entry}`, category, entry, []));
      else item.append(listRow('settings-strength-row', entry, statusLabel(entry), entry, []));
      return item;
    }),
  );
}
