/**
 * The words a mark's colour is chosen from: a list panel's row, its lead and the parts of its detail lines, and a PR's status (`prstatus.ts`).
 * One list, so a mark never grows a palette of its own; the colours of `attention`, `positive` and `danger` are the tone map in `tone.css`, which each module drawing a tone imports, and `normal` and `muted` set none.
 */
export const TONES = ['normal', 'attention', 'positive', 'muted', 'danger'] as const;
export type Tone = (typeof TONES)[number];
