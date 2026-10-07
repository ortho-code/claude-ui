import type { SessionSummary } from '../../../../shared/types';
import { fromMarkup } from '../../../dom';
import { Keyed } from '../../../keyed';
import type { GroupJumpTarget } from '../../../logic';
import './drawn.css';

/**
 * THE SESSION LIST AS DRAWN: its element, which the sidebar places (index.ts), and what is on screen in it by key, which the list's parts share — the draw (list.ts) fills these, the headings, the rows, the folds and the reveals read them.
 * It imports none of those parts, so each of them can import it.
 */

/** The list itself. */
export const container = fromMarkup(`<div id="sessions" aria-live="polite"></div>`);

// Status dots by tip session id; rebuilt each render (a status event names a session id).
export const statusDots = new Map<string, HTMLElement>();
// Row elements by entity key (the session id), kept across renders and left where they are (keyed.ts) — no flicker, no scroll jump, and a press or the focus on a row that keeps its place survives a render.
export const sessionRows = new Keyed<HTMLElement>((row) => row);
// Every section currently rendered, so collapse-all/expand-all acts on precisely what is on screen rather than on everything that has ever existed.
// Each render replaces its two lists rather than the object, since a module cannot assign to a binding another module exports.
export const renderedSections: { projects: string[]; groups: string[] } = { projects: [], groups: [] };

export interface ProjectSectionEls {
  section: HTMLElement;
  heading: HTMLElement;
  caret: HTMLElement;
  count: HTMLElement;
  /** The folder in front of the name, which turns into the crossed-out folder when the project's folder is gone. */
  icon: HTMLElement;
  label: HTMLElement;
  /** Opens the jump-to-a-group menu; hidden below 2 targets, disabled while filtering. */
  groupsBtn: HTMLButtonElement;
  /** The new-session split-button's dropdown caret; hidden unless the project is a git repo. */
  addCaret: HTMLElement;
  /** The new-session "+" itself, disabled when the project's folder is gone. */
  addBtn: HTMLButtonElement;
}
// What each project's group menu offers, refreshed on every render so the menu can't name a group that has since been deleted or renamed.
export const jumpTargets = new Map<string, GroupJumpTarget[]>();
// Project sections by repo root, kept across renders as the rows are.
export const projectSections = new Keyed<ProjectSectionEls>((els) => els.section);

export interface GroupSectionEls {
  section: HTMLElement;
  /** The h3 itself — what a jump scrolls to and flashes. */
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
  /** The new-session split-button's dropdown caret; hidden unless the project is a git repo. */
  addCaret: HTMLElement;
  /** The new-session "+" itself, disabled when the project's folder is gone. */
  addBtn: HTMLButtonElement;
  /** Holds the member rows; the indent and its rail live on this element. */
  members: HTMLElement;
  /** Shown instead of rows when the group has no members yet. */
  empty: HTMLElement;
}
// Group sections by group id, kept across renders as the project sections are.
export const groupSections = new Keyed<GroupSectionEls>((els) => els.section);
// The session each row currently shows, by entity key (session id), so a reused row's click/pin handlers act on the live session data of the latest render.
// Refilled by each render rather than replaced, since a module cannot assign to a binding another module exports.
export const currentByKey = new Map<string, SessionSummary>();
