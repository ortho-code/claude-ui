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

/** One helper for every collapsible section's caret — a project's, a group's, a list panel's section — so no two can drift apart. */
export const caretIcon = (collapsed: boolean, size: number): string => chevronIcon(collapsed ? 'right' : 'down', size);

/** The cross that closes or removes: a toast, a filter chip, a cold tab, the window. */
export const closeIcon = (size: number): string => strokeIcon(size, '<path d="M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4" />');

// A tab's button ends the session before it removes the tab, so it needs two marks rather than one: the media-stop square for the first press, the cross for the second. Squared off at 6.6 units so it reads at the same weight as the cross's diagonal.
export const stopIcon = (size: number): string => strokeIcon(size, '<rect x="4.7" y="4.7" width="6.6" height="6.6" rx="1.2" />');

// A group's mark: layers, meaning "several things stacked as one". Muted, never accent — the accent belongs to the project's folder icon one line above it.
export const layersIcon = (size: number): string => strokeIcon(size, '<path d="M8 2.2 2 5.4l6 3.2 6-3.2-6-3.2Z" /><path d="M2.4 9.2 8 12.2l5.6-3" />');

// A project's mark, and the same folder with a slash through it for one whose directory is not there any more: ONE folder, so swapping the two moves no outline.
const FOLDER_PATH = '<path d="M2 3.5h4l1.5 1.5H14v7.5H2z" />';
export const folderIcon = (size: number): string => strokeIcon(size, FOLDER_PATH);
export const folderGoneIcon = (size: number): string => strokeIcon(size, `${FOLDER_PATH}<line x1="2.8" y1="13.2" x2="13.2" y2="2.8" />`);

// The family/worktree marks.
// Both used to be font glyphs, and not even from the same font: ⑂ (U+2442) is absent from DejaVu Sans and resolved from FreeMono, a MONOSPACE face, while ⎇ (U+2387) came from DejaVu — which is why they never matched weight and needed hand-tuned font-size corrections.
// Conventional icons instead: a fork (one session split into a family) and a branch off a trunk (a linked worktree).
// Asymmetric vs symmetric, so they stay apart at badge size.
// Both are drawn so their INK is centred on 8,8 and 10 units tall, not merely their viewBox: the first cut centred the boxes while the fork hung 1.25 low and the branch filled 7.5 units against the fork's 11, which read as one mark misaligned and the other too small.
export const SIBLING_ICON = strokeIcon(11, '<path d="M8 12V8M4 4L8 8L12 4" />');
export const WORKTREE_ICON = strokeIcon(11, '<path d="M4.5 12V4M4.5 8Q11.5 8 11.5 4" />');

// The pin, as SVG rather than the ★/☆ glyphs: those resolve through system font fallback (DejaVu Sans under WSLg), whose outline star is a hairline that reads far fainter than its --muted colour should.
// Same star either way — filled for pinned, outlined for not — so the two states differ by ink, not by colour, and both render at a weight we control instead of the font's.
const STAR_PATH =
  'M8 2.1 L9.41 6.06 L13.61 6.18 L10.28 8.74 L11.47 12.77 L8 10.4 L4.53 12.77 L5.72 8.74 L2.39 6.18 L6.59 6.06 Z';
export const PIN_ICON = strokeIcon(14, `<path d="${STAR_PATH}" />`);
export const PINNED_ICON = strokeIcon(14, `<path d="${STAR_PATH}" fill="currentColor" />`);
