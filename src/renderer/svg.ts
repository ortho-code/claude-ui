import type { TabButtonMark } from './logic';

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

/** The plus that adds one more of something, such as a new session from a heading. */
export const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');

/** The cross that closes or removes: a toast, a filter chip, a cold tab, the window. */
export const closeIcon = (size: number): string => strokeIcon(size, '<path d="M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4" />');

// A tab's button ends the session before it removes the tab, so it needs two marks rather than one: the media-stop square for the first press, the cross for the second.
// Squared off at 6.6 units so it reads at the same weight as the cross's diagonal.
// Filled, it is the force a stop becomes when the session has not left: the same act, harder.
export const stopIcon = (size: number, force = false): string =>
  strokeIcon(size, `<rect x="4.7" y="4.7" width="6.6" height="6.6" rx="1.2"${force ? ' fill="currentColor"' : ''} />`);

// A pause on its way out shows the pause it is heading for, as its dot does: two strokes the stop square's height, then, as its force, two filled bars over the same centres.
// Bars rather than strokes for the force, since a stroke already as wide as a narrow bar would look the same filled or not.
export const pauseIcon = (size: number, force = false): string =>
  strokeIcon(size, force ? '<rect x="5" y="4.7" width="1.6" height="6.6" rx="0.5" fill="currentColor" /><rect x="9.4" y="4.7" width="1.6" height="6.6" rx="0.5" fill="currentColor" />' : '<path d="M5.8 4.7V11.3M10.2 4.7V11.3" />');

// Archiving's mark: a lidded box, the archived filter's.
// Ink spans the full 16-unit box horizontally and 3..13 vertically, centred on (8,8) like the rest, so it sits square beside the star and the branch.
export const archiveIcon = (size: number): string => strokeIcon(size, '<path d="M2.5 3.2h11v3h-11z" /><path d="M3.6 6.2v6.6h8.8V6.2" /><path d="M6.4 9h3.2" />');

// The forces of a close and an archive: the force-stop square, larger, with the act's own mark cut through it, so one shape says "force" and the cut says which (decided 2026-10-28, from a mock).
// A filled cross would be the plain one, being only two strokes.
// Cut as holes of an even-odd fill rather than through a mask, whose id every tab would share, and whose first copy could sit in a tab the folded bar hides.
const FORCE_SQUARE = 'M5.4 3.6H10.6A1.8 1.8 0 0 1 12.4 5.4V10.6A1.8 1.8 0 0 1 10.6 12.4H5.4A1.8 1.8 0 0 1 3.6 10.6V5.4A1.8 1.8 0 0 1 5.4 3.6Z';
// The cross's outline, its arms 1.1 units wide.
const CUT_CROSS = 'M6.2 10.58L8 8.78L9.8 10.58L10.58 9.8L8.78 8L10.58 6.2L9.8 5.42L8 7.22L6.2 5.42L5.42 6.2L7.22 8L5.42 9.8Z';
// The lidded box at 0.55 of its size, each stroke a ring: the lid's outline and its inside, the body's walls and its inside, then the slot.
const CUT_BOX = 'M4.53 4.91H11.47V7.46H4.53Z M5.43 5.81H10.57V6.56H5.43Z M5.13 7.46H10.87V11.09H5.13Z M6.03 7.46H9.97V10.19H6.03Z M6.9 8.1H9.1V9H6.9Z';
const forceIcon = (size: number, cut: string): string =>
  strokeIcon(size, `<path d="${FORCE_SQUARE} ${cut}" fill="currentColor" fill-rule="evenodd" stroke="none" />`);

/** A tab's button's mark, as its rule says it (`tabButton`), wherever the button is drawn. */
export const tabButtonIcon = (mark: TabButtonMark, size: number): string => {
  if (mark === 'close') return closeIcon(size);
  if (mark === 'force-close') return forceIcon(size, CUT_CROSS);
  // The filter's box spans the whole 16 units, so drawn smaller to stand as tall as the stop square beside it.
  if (mark === 'archive') return archiveIcon(Math.round(size * 0.65));
  if (mark === 'force-archive') return forceIcon(size, CUT_BOX);
  if (mark === 'pause' || mark === 'force-pause') return pauseIcon(size, mark === 'force-pause');
  return stopIcon(size, mark === 'force-stop');
};

// A group's mark: layers, meaning "several things stacked as one".
// Muted, never accent — the accent belongs to the project's folder icon one line above it.
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
// A task scheduled to run later: a clock face, its ink centred on 8,8 and 10 units tall as the family and branch marks' are (a radius of 4.1 plus the stroke at 11px), so it sits beside them as one of the set.
export const CLOCK_ICON = strokeIcon(11, '<circle cx="8" cy="8" r="4.1" /><path d="M8 5.7V8l1.6 1.1" />');
// A session set aside for later: a bookmark, picked from a mock over a calendar, an hourglass, a come-back arrow and a snooze "z" (decided 2026-10-29); y 4 to 12 and centred on 8 as the marks above.
export const LATER_ICON = strokeIcon(11, '<path d="M5.5 4h5v8L8 10l-2.5 2z" />');
// A pull request: the line it leaves from, and the change curving back into it with an arrowhead, the conventional mark; two strokes where the fork and the branch are one, so it stays apart from both.
// Drawn over the same height as theirs, y 4 to 12, and centred on 8,8 as they are.
export const PR_ICON = strokeIcon(11, '<path d="M4.5 4V12" /><path d="M11.5 12V8Q11.5 5.5 8.75 5.5" /><path d="M10.25 4L8.75 5.5L10.25 7" />');

// The pin, as SVG rather than the ★/☆ glyphs: those resolve through system font fallback (DejaVu Sans under WSLg), whose outline star is a hairline that reads far fainter than its --muted colour should.
// Same star either way — filled for pinned, outlined for not — so the two states differ by ink, not by colour, and both render at a weight we control instead of the font's.
const STAR_PATH =
  'M8 2.1 L9.41 6.06 L13.61 6.18 L10.28 8.74 L11.47 12.77 L8 10.4 L4.53 12.77 L5.72 8.74 L2.39 6.18 L6.59 6.06 Z';
export const PIN_ICON = strokeIcon(14, `<path d="${STAR_PATH}" />`);
export const PINNED_ICON = strokeIcon(14, `<path d="${STAR_PATH}" fill="currentColor" />`);
// The filled star at a badge's size, beside the marks above: a panel's folder picked for its session rather than followed, held in place as a pinned session is.
export const PINNED_BADGE_ICON = strokeIcon(11, `<path d="${STAR_PATH}" fill="currentColor" />`);

// The eye: a panel's `eye` icon, and the live strip's button that hides a project from it, one drawing for both.
export const EYE_PATH = '<path d="M1.6 8S4 3.8 8 3.8 14.4 8 14.4 8 12 12.2 8 12.2 1.6 8 1.6 8z" /><circle cx="8" cy="8" r="2" />';
export const eyeIcon = (size: number): string => strokeIcon(size, EYE_PATH);

// A note's mark: a page with a line of writing on it.
export const NOTE_ICON = strokeIcon(13, '<path d="M4 2.5h8v11H4z" /><path d="M6.25 6h3.5M6.25 8.75h3.5" />');
