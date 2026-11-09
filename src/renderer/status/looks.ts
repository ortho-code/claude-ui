import { ICONS, isIconName } from '../../shared/helpers/icons';
import { NEEDS_YOU, resolvedLooks, type ResolvedLook } from '../../shared/status/looks';
import { isNeeds } from '../rules/logic';
import type { View } from '../state/app';
import { strokeIcon, svgImage } from '../ui/svg';

/**
 * THE LOOKS' STYLESHEET: every status's, category's and type's look, as `settings.json`'s `looks` and the defaults resolve them (shared/status/looks.ts), written into the page as one stylesheet, a rule per look on its class (`lookClass`).
 * A dot carries its look's class beside its state's (statusdot.ts), so no surface builds anything of its own for a look.
 */

/** The id of the look a dot showing `state` is drawn in: a reason's type, `needs-you` for a panel's `needs`, a status its own; none for a state that is not a session's, such as a tab stopping or a run that failed. */
export function lookOf(state: string): string | null {
  if (isNeeds(state)) return state.slice('needs:'.length);
  if (state === 'needs') return NEEDS_YOU;
  return state === 'stopping' || state === 'failed' ? null : state;
}

/** The class that draws the look of `id`, its id kept to what a class name can hold. */
export const lookClass = (id: string): string => `look-${id.replace(/[^\w.-]/g, '_')}`;

/** The pulse of a look that asks for you, the same pace as it has always had. */
const PULSE = 'pulse 1.2s ease-in-out infinite';

/** An icon drawn 11px in the 9px dot's place, 1px over each side, so the dot's box and what sits beside it do not move. */
const ICON_SIZE = 11;

/**
 * The rules that draw `look` on a dot of class `lookClass(id)`, and its colour as `--look` on anything carrying that class, for a surface that takes only its colour, such as a toast's edge.
 * The rail icon's corner draws any look as a filled dot of its colour (`.dotted-icon`): an icon on an icon's corner would read as neither.
 */
export function lookRules(id: string, look: ResolvedLook): string {
  return rulesOn(selectorOf(id), look);
}

/** The class selector of `id`'s look, the dots in its id escaped so they do not read as a second class. */
const selectorOf = (id: string): string => `.${lookClass(id).replace(/\./g, '\\.')}`;

/** The rules that draw `look` on whatever carries the class selector `on`. */
function rulesOn(on: string, look: ResolvedLook): string {
  const { colour, mark, core, pulse } = look;
  const shape =
    mark === 'dot'
      ? [`background: ${colour}`, `border-color: ${colour}`]
      : mark === 'ring'
        ? ['background: transparent', `border-color: ${colour}`]
        : mark === 'spinner'
          ? ['border-width: 2px', `border-color: color-mix(in srgb, ${colour} 25%, transparent)`, `border-top-color: ${colour}`, `border-right-color: ${colour}`, ...(core === null ? [] : ['padding: 1px', `background: ${core}`, 'background-clip: content-box'])]
          : ['position: relative', 'border-color: transparent'];
  const motion = mark === 'spinner' ? ['animation: spin 1.5s linear infinite'] : pulse ? [`animation: ${PULSE}`] : [];
  const rules = [`${on} { --look: ${colour}; }`, `.nudge${on} { ${[...shape, ...motion].join('; ')}; }`];
  if (isIconName(mark)) {
    const svg = strokeIcon(ICON_SIZE, ICONS[mark]);
    rules.push(`.nudge${on}::before { content: ''; position: absolute; inset: -2px; background: ${colour}; mask: ${svgImage(svg)} center / ${ICON_SIZE}px no-repeat; }`);
  }
  rules.push(`.dotted-icon > .nudge${on} { padding: 0; border-width: 1px; border-color: ${colour}; background: ${colour}; animation: ${pulse ? PULSE : 'none'}; }`, `.dotted-icon > .nudge${on}::before { content: none; }`);
  return rules.join('\n');
}

/**
 * The whole stylesheet for `looks`, by id.
 * It opens with the needs-you look on the dot of a reason whose type has no look here (`.needs` without any of their classes), so a reason of a type the needs-you files do not define, which ranks at `needs-you`, draws as needs-you rather than as no look at all.
 * That rule keeps a type's rule's weight, the `:not` inside `:where`, so read's dimming, coming later, still wins over it.
 */
export function looksStylesheet(looks: ReadonlyMap<string, ResolvedLook>): string {
  const needsYou = looks.get(NEEDS_YOU);
  const classes = [...looks.keys()].map(selectorOf).join(', ');
  return [...(needsYou ? [rulesOn(`.needs:where(:not(${classes}))`, needsYou)] : []),...[...looks].map(([id, look]) => lookRules(id, look))].join('\n');
}

/**
 * Write the looks into the page and again whenever the looks or the needs-you categories change.
 * It goes first in the head, so the dot's own rules in the app's stylesheets, read and the rest, come after it and win at the same weight.
 */
export function startLooks(watch: (slices: ['settings', 'needsYouTypes'], fn: (view: View<'settings' | 'needsYouTypes'>) => void) => unknown, now: View<'settings' | 'needsYouTypes'>): void {
  const sheet = document.createElement('style');
  sheet.id = 'looks';
  document.head.prepend(sheet);
  const draw = (view: View<'settings' | 'needsYouTypes'>): void => {
    sheet.textContent = looksStylesheet(resolvedLooks(view.settings?.looks.value ?? {}, view.needsYouTypes));
  };
  draw(now);
  watch(['settings', 'needsYouTypes'], draw);
}
