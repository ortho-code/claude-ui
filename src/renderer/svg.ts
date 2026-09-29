/**
 * Every stroked icon in the app, drawn through one helper.
 *
 * `ink` is the stroke the user actually SEES, in px — the viewBox is a fixed 16 units, so a constant stroke-width would draw a 9px caret at two-thirds the weight of a 14px one and the set would look mismatched at exactly the sizes the chrome uses.
 * Converting px to units per size keeps every mark the same visual weight, and 1.3px is the weight the folder and layers icons render at.
 * The ink is centred on (8,8) in the viewBox by each path, so flex centring lands an icon square with no nudge.
 */
export const strokeIcon = (size: number, path: string, ink = 1.3): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${((ink * 16) / size).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

const CHEVRONS = {
  up: 'M4 10L8 6L12 10',
  down: 'M4 6L8 10L12 6',
  left: 'M10 4L6 8L10 12',
  right: 'M6 4L10 8L6 12',
} as const;

export type Direction = keyof typeof CHEVRONS;

/** A chevron pointing `direction`: the app's one mark for folding and opening, from a project's caret to a panel's fold. */
export const chevronIcon = (direction: Direction, size: number): string => strokeIcon(size, `<path d="${CHEVRONS[direction]}" />`);

// The pin, as SVG rather than the ★/☆ glyphs: those resolve through system font fallback (DejaVu Sans under WSLg), whose outline star is a hairline that reads far fainter than its --muted colour should.
// Same star either way — filled for pinned, outlined for not — so the two states differ by ink, not by colour, and both render at a weight we control instead of the font's.
const STAR_PATH =
  'M8 2.1 L9.41 6.06 L13.61 6.18 L10.28 8.74 L11.47 12.77 L8 10.4 L4.53 12.77 L5.72 8.74 L2.39 6.18 L6.59 6.06 Z';
export const PIN_ICON = strokeIcon(14, `<path d="${STAR_PATH}" />`);
export const PINNED_ICON = strokeIcon(14, `<path d="${STAR_PATH}" fill="currentColor" />`);
