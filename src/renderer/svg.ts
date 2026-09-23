/**
 * Every stroked icon in the app, drawn through one helper.
 *
 * `ink` is the stroke the user actually SEES, in px — the viewBox is a fixed 16 units, so a constant stroke-width would draw a 9px caret at two-thirds the weight of a 14px one and the set would look mismatched at exactly the sizes the chrome uses.
 * Converting px to units per size keeps every mark the same visual weight, and 1.3px is the weight the folder and layers icons render at.
 * The ink is centred on (8,8) in the viewBox by each path, so flex centring lands an icon square with no nudge.
 */
export const strokeIcon = (size: number, path: string, ink = 1.3): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${((ink * 16) / size).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
