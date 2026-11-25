import type { SessionSummary } from '../../../../shared/types';
import { fromMarkup } from '../../../ui/dom';
import { Keyed } from '../../../ui/keyed';
import type { RowLines } from '../../../rules/sectioned-view';
import type { ProjectTree } from '../../../rules/session-list';
import './drawn.css';

/**
 * THE SESSION LIST AS DRAWN: its element, which the sidebar places (index.ts), and what is on screen in it by key, which the list's parts share — the draw (list.ts) fills these, the headings, the rows, the folds and the reveals read them.
 * It imports none of those parts, so each of them can import it.
 */

/** The list itself. */
export const container = fromMarkup(`<div id="sessions" aria-live="polite"></div>`);

/** What a row shows from the tab running its session: its clock, and the words for a stop claude has not left, which stand in for its time and model (`metaText`). */
export interface RowTabMarks {
  clock: HTMLElement;
  notLeft: HTMLElement;
  metaText: HTMLElement;
}

/**
 * What one list keeps of the session rows it draws, so there can be more than one list of rows in the window.
 */
export class DrawnRows {
  /** Row elements by entity key (the session id), kept across renders and left where they are (keyed.ts) — no flicker, no scroll jump, and a press or the focus on a row that keeps its place survives a render. */
  readonly rows = new Keyed<HTMLElement>((row) => row);
  /** Status dots by session id, rebuilt each render, since a status event names a session id. */
  readonly dots = new Map<string, HTMLElement>();
  /** The rows' marks from their tabs by session id, which a tab's change can alter without the list drawing again. */
  readonly tabMarks = new Map<string, RowTabMarks>();
  /** The session each row shows now, by entity key, so a kept row's handlers act on the live session of the latest render; refilled by each render. */
  readonly current = new Map<string, SessionSummary>();
  /**
   * How many times what rows draw from besides their own session has changed: a row drawn at the same count, for a session drawn the same, is left as it is (`updateRow`).
   * The list's draw moves it.
   */
  readonly inputs = { generation: 0 };
  /** The flat sections by id, kept across renders as the rows are. */
  readonly flat = new Keyed<FlatSectionEls>((els) => els.section);
  /** The rows the last pass marked as having a tab, whose marks the next pass takes off where their tab has gone (`markTabs`). */
  markedTabs = new Set<HTMLElement>();

  /** `sidebar`: the rows are the sidebar's list, so they follow its bulk mode and its finished view; another list's rows open their session on a press whatever the sidebar is in. */
  constructor(readonly sidebar: boolean) {}
}

/** The sidebar's list. */
export const sidebarRows = new DrawnRows(true);

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
  /** Opens the jump-to-a-group menu; hidden below 2 targets. */
  groupsBtn: HTMLButtonElement;
  /** The new-session split-button's dropdown caret, on every heading; its worktree item says when the project is no git repository. */
  addCaret: HTMLElement;
  /** The new-session "+" itself, disabled when the project's folder is gone. */
  addBtn: HTMLButtonElement;
  /** The line under the heading of a project whose sessions are all finished, saying so; placed only for such a project. */
  allFinishedLine: HTMLElement;
}
// Each project as last drawn, for its jump menu, refreshed on every render so the menu can't name a group that has since been deleted or renamed.
export const jumpTrees = new Map<string, ProjectTree>();
/** What a project's folder allows, by repo root, refreshed for each project a render draws, for the menus that start a session there (`newSessionItems`): whether it is a git repository, and why nothing can start in it, null while something can. */
export const projectFacts = new Map<string, { isRepo: boolean; goneReason: string | null }>();
// Project sections by repo root, kept across renders as the rows are.
export const projectSections = new Keyed<ProjectSectionEls>((els) => els.section);

export interface GroupSectionEls {
  section: HTMLElement;
  /** The h3 itself — what a jump scrolls to and flashes. */
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
  /** The new-session split-button's dropdown caret, on every heading; its worktree item says when the project is no git repository. */
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

/**
 * A section of the list drawn flat, as the list draws it (list.ts), such as one of the review's sets under its heading; its id names it for good, a heading and all.
 * Its rows in the order they are shown.
 */
export interface FlatSection {
  id: string;
  heading: { name: string; count: number; note: string | null } | null;
  rows: readonly SessionSummary[];
  lines: RowLines;
}

/** A flat section as drawn: its section, the well its rows sit in, and its heading's parts where it has one — its name, its count, and the line saying why it cannot answer. */
export interface FlatSectionEls {
  section: HTMLElement;
  rows: HTMLElement;
  heading: { heading: HTMLElement; label: HTMLElement; count: HTMLElement; note: HTMLElement } | null;
}

/** The keys of the rows drawn under `scope`, in the order drawn, a folded section's included: what a Shift+press ticks a run of, what the bar acts on of what is ticked (bulk.ts), and what the list's order is compared against at each minute (list.ts). */
export function drawnKeys(scope: ParentNode = container): string[] {
  return [...scope.querySelectorAll<HTMLElement>('.session')].map((row) => row.dataset.key ?? '').filter(Boolean);
}
