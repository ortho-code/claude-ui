import type { MenuItem } from '../menu';
import type { IconName } from './icons';
import type { PanelSlot } from './layout';
import type { OptionsDecl } from './options';

/**
 * The contract between the panel tree and every panel type, the app's own and the kinds behind the config folder's types alike: what a type declares, what the tree hands a mounted panel (its host), and what the tree drives it through.
 * Types only, so every module imports it with `import type` and none of it reaches the bundle; which is also why nothing that must be bundled, a stylesheet included, can live beside it.
 */

/** What the LAYOUT knows about a type: how to draw and place an entry of it, and nothing about its options. */
export interface PanelTypeDecl {
  name: string;
  /**
   * The title an entry gets when it names none, from its options where they give one; null when they do not, and the layout uses the id.
   * Called before the type has checked anything, so it reads the options defensively.
   */
  defaultTitle(options: Record<string, unknown>): string | null;
  /** The icon an entry wears on a rail when it names none. */
  icon: IconName;
  /** The panel carries its own chrome, so a group holding only it draws no header. */
  bare?: boolean;
  /**
   * The layout must place this type EXACTLY ONCE: one missing is added, a second copy is refused in its place, and `hidden` is ignored.
   * For the app's own surfaces, without which the window is not usable — the rule is the validator's, so no file can produce a window without the terminal.
   */
  singleton?: boolean;
  /**
   * What the type itself was built from, for one that can change while the app runs — a type from the config folder, whose manifest is edited by hand: a change mounts its entries afresh.
   * Absent for a built-in, which changes only with the build.
   */
  revision?: string;
}

/** Where a panel would run right now: the renderer's active tab and selected project, as the side reads them. */
export interface Where {
  tab: { cwd: string; repoRoot: string; id: string } | null;
  project: string | null;
}

/**
 * What a panel's icon on a rail says about it, so a panel that is not on show still reports: a session waiting for you, or a run that failed.
 * Null says nothing.
 */
export type PanelStatus = 'wait' | 'fail' | null;

/**
 * A claude session a panel asks the app for, from one of its items: what it is about, and what the session starts with.
 * An ASK, not a start: the app opens its own dialog on it, and nothing starts until the person presses Start there.
 */
export interface SessionRequest {
  /** The panel asking, by its title. */
  from: string;
  /** The item's key, which the session is remembered by. */
  key: string;
  /** The item's text. */
  label: string;
  href: string | null;
  /** The session's name, or null for the app's own label. */
  name: string | null;
  prompt: string;
  /** Where the panel last ran, so the dialog can offer the project that folder is in; null when it has not run. */
  dir: string | null;
}

/** A session one of the panel's items started, as the app sees it now: what to call it, its status dot, and whether it is running. */
export interface LinkedSession {
  id: string;
  title: string;
  /** The status dot's state, as the session list draws it; null for a session with nothing to report. */
  status: string | null;
  /** For a `background` status, what still runs behind its finished turn, by the type claude gives each piece of work; empty when nothing is known. */
  background: readonly string[];
  /** Its dot marked read. */
  acked: boolean;
  /** A tab holds it with its process live. */
  running: boolean;
}

/** Where a session's menu is opened: its row in the list, its tab, or its row in the live strip. */
export type SessionSurface = 'row' | 'tab' | 'strip';

/**
 * What one surface asks another for, through the host every panel is given (docs/architecture.md § The app's own surfaces are panels): each ask is answered by the built-in that owns it, so no surface reaches into another's code.
 * By session id or project folder, never a tab's token, which is the terminal area's own.
 */
export interface Asks {
  // Answered by the terminal area.
  /** Go to a session, as a jump from the live strip does: its project, its tab (resumed when it is not running, with `prompt` as its first when given), its row. */
  openSession(id: string, prompt?: string): void;
  /** Open a session's tab, started when it is not running, and nothing else: what a click on its row does, which moves neither the list nor the project. */
  openTab(id: string): void;
  /** Start a brand-new session in `cwd`, filed in `groupId` when given, under `id` when the caller minted one to remember it by. */
  openNewSession(cwd: string, groupId?: string, launch?: { name?: string; prompt?: string }, id?: string): Promise<void>;
  /** Start a session in a new git worktree of the project, named as the dialog it opens is answered. */
  openWorktreeSession(repoRoot: string, groupId?: string): Promise<void>;
  /** Fork a session, named as the dialog it opens is answered, into its parent's group. */
  forkSession(id: string): Promise<void>;
  /** Press a session's tab's button, as on the tab: stop a running session, force one that has not left once it may, or close a cold tab. */
  pressTabButton(id: string): void;
  /** Set a session's tab aside, paused: its claude ended if it runs, the tab marked either way. */
  pauseSession(id: string): void;
  /** Take the paused mark off a session's tab. */
  unpauseSession(id: string): void;
  /** Close every tab a session is open in, ending what runs there. */
  closeTabs(id: string): void;
  /** The terminal area's half of selecting a project: the tabs on show and the tab in front follow it. */
  showProject(repoRoot: string | null): void;
  // Answered by the session list.
  /** Select a project, or All for null, as the switcher does. */
  selectProject(repoRoot: string | null): void;
  /** Bring a session's row into view, unfolding what hides it. */
  revealSession(id: string): void;
  /** Bring a project's heading into view, unfolding it. */
  revealProject(repoRoot: string): void;
  /** Bring a group's heading into view, or the project's rows in no group for null, and flash it. */
  revealGroup(repoRoot: string, groupId: string | null): void;
  /** A session's menu, as the kebab on `from` lists it, for another surface to open: null for a session the app no longer has. */
  sessionMenu(id: string, from: SessionSurface): MenuItem[] | null;
}

/** One way a panel can show what it shows, such as flat or as a tree, which its header offers in a switch. */
export interface PanelView {
  /** What the layout entry's `view` names, and what the panel is given back as its pick. */
  id: string;
  /** What its button in the switch says when hovered. */
  label: string;
  icon: IconName;
}

/** One of the tabs a panel shows in its header, in place of its title (`PanelHost.setTabs`): what it says, and in what state. */
export interface PanelTab {
  /** The panel's own id for it, which every action is handed back. */
  id: string;
  text: string;
  tooltip: string | null;
  /** The one on show. */
  shown: boolean;
  /** Nothing runs behind it. */
  cold: boolean;
  /** Its button: the cross that closes it, or the square that stops what runs behind it first; the press is the panel's either way. */
  button: { mark: 'close' | 'stop'; tooltip: string };
  /**
   * The row it sits in, such as its project where tabs are shown by project: a row per cluster, in the order the tabs first name them, led by its label, and a drag stays inside it.
   * Null for none: with every tab's null, the tabs share one row with no label; among tabs with clusters, the ones with none share a row of their own with no label.
   */
  cluster: { key: string; label: string } | null;
}

/**
 * A panel's tabs, which the tree draws in its header in place of the title, with a `+` after the last, and what a press on them does, which the panel answers.
 * The chrome stays the tree's, as the view switch's does: the panel says what its tabs are, never how they are drawn.
 */
export interface PanelTabs {
  tabs: PanelTab[];
  /** What the `+` after the last tab says it does. */
  addLabel: string;
  /** Why the `+` cannot make a tab now, shown on it, which is then unavailable; null when it can. */
  addRefused: string | null;
  /** What a tab's kebab says it holds, such as "Terminal options". */
  kebabLabel: string;
  select(id: string): void;
  /** Its button, and a middle-click on it, which skips the button's own checks, so the panel refuses whatever the button would. */
  press(id: string): void;
  /** Its kebab's menu, also on a right-click; null for nothing to offer. */
  menu(id: string): MenuItem[] | null;
  /** A double-click on it. */
  rename(id: string): void;
  /** A drag ended, leaving its row's tabs in this order. */
  reorder(ids: string[]): void;
  add(): void;
  /** A press on a row's label, with the cluster's key. */
  showCluster(key: string): void;
  /**
   * Whether the rows are folded to one, the row of the tab on show, or with none on show the first, as the tab bar folds; the fold chevron shows while the tabs stand in two or more rows (`offerRowFold`).
   * The panel keeps it, on one row too, so it holds over a restart and a second row comes up folded.
   */
  folded: boolean;
  /** A press of the fold chevron, with what it asks for. */
  fold(folded: boolean): void;
}

/** What the tree gives a mounted panel: where it is, and the marks around it that are the tree's to draw — the panel's side of the conversation with the layout — and the asks it can make of the app's surfaces. */
export interface PanelHost extends Asks {
  where(): Where;
  /** The view picked for the panel: the one picked in its header on this machine, else its layout entry's `view` as the layout says it now; null without either, which is its first. */
  view(): string | null;
  /**
   * The views the panel offers: with two or more its header shows a switch between them, the picked one marked as shown, else the first.
   * A pick there is kept for the panel as a group's picked panel is, and runs it again (`refresh`).
   */
  setViews(views: PanelView[]): void;
  /**
   * The panel's tabs, drawn in its header in place of its title; null for none, which shows the title again.
   * Called again whenever they change: the tree keeps each tab's element by its id and draws them again in place, so a press on one survives a call that changes only the tabs, made between its press and its release.
   * The tree's own draws of the window put the tabs into a new header, as they do every header's controls.
   */
  setTabs(tabs: PanelTabs | null): void;
  setBusy(busy: boolean): void;
  /** The header's word on the last run: `exit 3`, `stopped after 30 s`, or '' for a run that ended well. */
  setEnd(label: string): void;
  /** The dot on the panel's rail icon. */
  setStatus(status: PanelStatus): void;
  /**
   * A count the panel reports, such as how many items wait: on its rail icon and beside its title.
   * Null for none.
   */
  setCount(count: number | null): void;
  /**
   * Why the panel cannot run, one sentence each, or none when it can: the tree draws them in the panel's place, with the same problem list as the layout's own refusals, and puts `alert` on its rail icon.
   * Different from a failed RUN, which is the red dot: this is a panel that will not start as its options stand.
   */
  setProblems(problems: string[]): void;
  /** Sentences about the panel that do not stop it running, shown in its group's note line. */
  setNotes(notes: string[]): void;
  /** Ask the app for a session from one of the panel's items (see `SessionRequest`). */
  startSession(request: SessionRequest): void;
  /** The sessions an item started that the app still has, latest first; empty until the panel's data has been read. */
  linkedSessions(itemKey: string): LinkedSession[];
  /** Offer several of an item's sessions in a menu at `anchor`, to go to one. */
  pickSession(anchor: HTMLElement, sessions: LinkedSession[]): void;
}

export interface MountedPanel {
  /** The panel's body, which the side places under its header. */
  el: HTMLElement;
  /** Run again, now. */
  refresh(): void;
  /** The tab or project changed; run again if that moved the panel's context. */
  contextChanged(): void;
  /**
   * The panel went behind another tab, into a folded group, or back on screen.
   * A panel is mounted HIDDEN and shown by the first call with true, which is where it first runs.
   * Hiding stops nothing: a hidden panel keeps its DOM and its process, and only removal from the file ends them.
   */
  setVisible(visible: boolean): void;
  /** Something in the config folder changed: check the options again, since a file or folder they point at may have appeared or changed. */
  recheck(): void;
  /**
   * A session's status, a tab, or the sessions the panel's items started changed: repaint what the panel draws of them.
   * For the types that draw any.
   */
  sessionsChanged?(): void;
  /** The panel is leaving the layout: stop its run and forget it. */
  unmount(): void;
}

export interface PanelType extends PanelTypeDecl, OptionsDecl {
  /** What the header's one button does, for its tooltip and label, from the entry's options: "Refresh" when the type says nothing, and no button for null. */
  actionLabel?(options: Record<string, unknown>): string | null;
  mount(slot: PanelSlot, host: PanelHost): MountedPanel;
}
