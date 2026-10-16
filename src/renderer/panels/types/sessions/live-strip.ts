import type { SessionSummary } from '../../../../shared/types';
import { byId, fromMarkup } from '../../../dom';
import { Keyed, placeChildren, setMarkup } from '../../../keyed';
import { asksForYou, entityKey, orderAsTabs, sessionLabel, stripLine, strongestNudge, tabButtonState, type NudgeStatus, type SwitcherModel } from '../../../logic';
import { kebabButton, openMenu } from '../../../menu';
import { markProjectGone } from '../../../projectgone';
import { store, type View } from '../../../state/app';
import { hideFromStrip } from '../../../state/strip';
import { isPaused, projectGone, projName, projectGroups, sessionById, sessionNudge, switcherModel, switcherPool, tabOnShow, tabWith } from '../../../state/views';
import { ackOnClick, applyStatus, badgeClass } from '../../../statusdot';
import { chevronIcon, eyeIcon, tabButtonIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { setUnavailable, unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import { sessionMenuItems } from './actions';
import '../../../menu-row.css';
import './live-strip.css';

/**
 * The live strip, at the foot of the sidebar: every running session and every paused tab, wherever it is, under a line badged with the switcher's roll-up that folds the rows away.
 * A row jumps to its session, its dot marks it read, and its button is its tab's, each through the sidebar's host; the row of the session on show is marked; the fold is the store's (`stripExpanded`).
 * A project's heading hides it from the strip (state/strip.ts): its heading and rows leave, and a Hidden line at the list's foot says how many projects are hidden and what they ask of you, and lists them in a menu whose pick shows one again.
 */

/** The strip, built here and placed by the sidebar (index.ts). */
export const liveStrip = fromMarkup(`
  <div id="live-strip" hidden>
    <div id="strip-list" hidden></div>
    <button id="strip-toggle" type="button" aria-expanded="false">
      <span id="strip-badge" class="nudge" hidden></span>
      <span id="strip-label"></span>
      <span class="strip-chev" aria-hidden="true"></span>
    </button>
  </div>`);
const stripToggle = byId(liveStrip, 'strip-toggle', HTMLButtonElement);
const stripBadge = byId(liveStrip, 'strip-badge');
const stripLabel = byId(liveStrip, 'strip-label');
const stripList = byId(liveStrip, 'strip-list');

/**
 * The Hidden line, placed at the list's foot while a hidden project has something in the strip: its dot first and then its words, as the strip's own line has them.
 * A menu rather than a fold: a hidden project's sessions are never listed, since a second caret in the strip, folding the hidden projects open, was taken for the strip's own fold.
 */
const hiddenLine = fromMarkup(`
  <button id="strip-hidden" type="button" aria-haspopup="menu">
    <span id="strip-hidden-badge" class="nudge" hidden></span>
    <span id="strip-hidden-label"></span>
  </button>`, HTMLButtonElement);
const hiddenBadge = byId(hiddenLine, 'strip-hidden-badge');
const hiddenLabel = byId(hiddenLine, 'strip-hidden-label');
setTooltip(hiddenLine, 'Pick a project to show it in the strip again');
// Listed afresh at each press, for the strip as it is then.
hiddenLine.addEventListener('click', () => {
  const view = store.get();
  openMenu(
    hiddenLine,
    hiddenProjects(switcherModel(view), stripProjects(switcherPool(view), view).ordered, view).map(({ project, badge }) => ({
      label: project.name,
      count: project.items.length,
      badge,
      onSelect: () => hideFromStrip(project.repoRoot, false),
    })),
  );
});

/** A strip row and the parts each render writes, built once per session (`buildRow`) and kept while it is listed. */
interface StripRow {
  row: HTMLElement;
  jump: HTMLButtonElement;
  dot: HTMLElement;
  name: HTMLElement;
  chip: HTMLElement;
  stop: HTMLButtonElement;
}

/** The rows by session id and the project headings by repo root, kept from one render to the next so a press on a row survives a status arriving mid-click (keyed.ts). */
const stripRows = new Keyed<StripRow>((kept) => kept.row);
const stripHeadings = new Keyed<StripHeading>((kept) => kept.heading);

/** A project's heading in the strip, and the parts each render writes: its name and the mark of a project whose folder is gone; the eye that hides it is set once, when it is built. */
interface StripHeading {
  heading: HTMLElement;
  name: HTMLElement;
  mark: HTMLElement;
}

function buildHeading(repoRoot: string): StripHeading {
  const heading = document.createElement('div');
  heading.className = 'strip-project';
  const name = document.createElement('span');
  const mark = document.createElement('span');
  mark.className = 'gone-mark';
  mark.hidden = true;
  // Shown on the heading's hover (live-strip.css); the Hidden line's menu is the way back.
  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'icon-btn compact strip-eye';
  setMarkup(eye, eyeIcon(14));
  setTooltip(eye, 'Hide from the live strip');
  eye.setAttribute('aria-label', 'Hide from the live strip');
  eye.addEventListener('click', () => hideFromStrip(repoRoot, true));
  heading.append(name, mark, eye);
  return { heading, name, mark };
}

/** Write what a kept heading shows for its project now: its name, and whether its folder is gone. */
function updateHeading({ name, mark }: StripHeading, project: { repoRoot: string; name: string }, view: View<'sessions' | 'tabs'>): void {
  name.textContent = project.name;
  // Marked as everywhere a project is named: a project's folder can be gone under a paused tab, or vanish while a session runs.
  markProjectGone(project.repoRoot, projectGone(project.repoRoot, view), name, mark, 11);
}

/** A session's row, built once: its handlers act on the session by its id when pressed, and everything they show is written by each render (`updateRow`). */
function buildRow(id: string): StripRow {
  // The row is a DIV holding buttons rather than one button, because a button cannot contain a button and this row has three things to do: jump to the session, open its menu, or press its tab's button.
  // The row shape (the menu row, menu-row.css) stays on the wrapper, so hovering anywhere in it still lights the whole row and the strip looks exactly as it did.
  const row = document.createElement('div');
  row.className = 'menu-row strip-item';
  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'strip-item-jump';
  // The roll-up badge rather than the sidebar's status dot: that one is 9px and bordered because it is a control in a dense row, where this sits on a row of its own.
  // It IS clickable though, and for the same reason the row is: acking a session anywhere else means going to where that session lives, which costs you the project you are looking at — the exact gap this strip exists to close.
  // The read state has to show either way, or a muted row reads as live — hence the acked modifier, which dims this badge exactly as it dims the dot.
  const dot = document.createElement('span');
  // A muted row stays LISTED: membership is a process or a pause, and acking says "seen it", not "stop".
  // Only the count above drops it.
  // A paused row's dot is no control (`applyStatus`), so a click on it is the jump's, which resumes the session.
  ackOnClick(dot, () => id);
  const name = document.createElement('span');
  name.className = 'strip-item-name';
  // The group as a CHIP rather than a third level of headings.
  // The strip is capped at 40vh, where a project -> group -> session nesting costs a heading row and an indent per group, and a chip costs no rows at all.
  // Worth revisiting if several sessions of one group routinely show here together, since the same chip repeated down a run of rows reads as noise where a single heading would not.
  const chip = document.createElement('span');
  chip.className = 'strip-item-group';
  jump.append(dot, name, chip);
  jump.addEventListener('click', () => hostOf('sessions').openSession(id));
  // The tab's own button, on the strip's row for it.
  // WHY IT BELONGS HERE: clicking a strip row calls `jumpToSession`, which is navigation — it switches the active project and activates the tab.
  // So acting on a stray session from its tab costs you your place: you go there, act, and come back.
  // This is the only way to act on a session in ANOTHER project without leaving the one you are looking at, which is the same gap the strip was built to close.
  // It IS the tab's button, pressed from here: one rule draws both (`tabButtonState`) and one press acts for both (`closeOrStop`, through the ask), so it stops a running session, forces one that has not left, and closes a paused tab.
  // A row leaves the strip by its session stopping without a pause, its tab being unpaused or closed, which is what this does to a paused one, or its session leaving the pool.
  // The session's own menu beside it, the one its row in the list has, Pause and Unpause with it: everything but the button, which stays in sight.
  // Listed afresh at each click, for the session as it is then.
  const kebab = kebabButton('compact strip-item-kebab abuts', 'Session options', () => {
    const session = sessionById(id);
    return session ? sessionMenuItems(session) : null;
  });
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'icon-btn compact strip-item-stop';
  // Pressed only while available, which each render decides from the tab as it is then (`updateRow`).
  stop.addEventListener('click', () => {
    if (unavailable(stop)) return;
    hostOf('sessions').pressTabButton(id);
  });
  row.append(jump, kebab, stop);
  return { row, jump, dot, name, chip, stop };
}

/** Write what a kept row shows for its session now: its dot, its name and group, whether it is the one on show, and its tab's button in the tab's state. */
function updateRow(parts: StripRow, session: SessionSummary, groupName: string | undefined, onShow: boolean, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'tabs'>): void {
  const { row, jump, dot, name, chip, stop } = parts;
  applyStatus(dot, session.id, view);
  name.textContent = sessionLabel(session);
  chip.textContent = groupName ?? '';
  chip.hidden = groupName === undefined;
  setTooltip(jump, sessionLabel(session, '') || null);
  // The class is the stylesheet's, the menu row's fill for what is on show, which the switcher's entry on show wears too; the attribute is what a screen reader reads.
  row.classList.toggle('active', onShow);
  if (onShow) jump.setAttribute('aria-current', 'true');
  else jump.removeAttribute('aria-current');
  const tab = tabWith(session.id, view);
  // No tab at all should not happen — membership is a tab's process or its pause — so it is inert rather than guessed at, saying only what is so.
  const { disabled, tooltip, mark } = tab ? tabButtonState(tab) : { disabled: true, tooltip: 'No tab to act on', mark: 'stop' as const };
  setMarkup(stop, tabButtonIcon(mark, 14));
  setUnavailable(stop, disabled ? tooltip : null, tooltip);
}

/** A project as the strip has it: its sessions in the strip, in their order. */
interface StripProject {
  repoRoot: string;
  name: string;
  items: SessionSummary[];
}

/** What the strip holds: its projects in order, each with its sessions, and which of those sessions are paused. */
function stripProjects(pool: SessionSummary[], view: View<'groupState' | 'projectNames' | 'projectOrder' | 'tabs'>): { ordered: StripProject[]; paused: ReadonlySet<string> } {
  // What is RUNNING, wherever it is running, and what you PAUSED — not what is nudging.
  // Membership used to be "has a live nudge", which meant marking a dot read deleted the row: muting said "erase this" when it should have said "seen it".
  // Running is also the only rule that closes the gap this strip exists for: scoped to one project, a live session in another is invisible in the tab bar (filtered to the active project) and out of scope in the list, and the switcher only ever gets you to a PROJECT, never back to a SESSION.
  // Paused widens it on purpose: a tab you set aside, or one that was running when the app closed, is work in hand, which the other cold tabs are not, and it is the same gap — a paused tab in another project is as far out of sight as a running one.
  // That is also what keeps the strip at launch, which used to start with nothing running and so with no strip at all.
  // Nothing is lost by dropping the nudge from the membership: a running session that stopped has reported SessionEnd or had its status forgotten (`coolTab`), so it cannot be nudging; a paused one can still hold a status from before, which is why the line's count leaves paused rows out.
  // IN TAB ORDER, which is the only order here that nothing on disk can move — see orderAsTabs.
  // Driven from the tabs rather than from the session list on purpose: every row in this strip IS a tab, and taking the order from the tabs array is what stops a session writing a message from swapping two rows you were reading.
  // A paused tab keeps its place among the running ones rather than gathering in a section of its own, so pausing or resuming a session never moves its row.
  // The session data still comes from the list, so a row shows what the sidebar shows; only the ORDER is the tab bar's.
  const shown = new Map(pool.map((s) => [entityKey(s), s]));
  const listed = view.tabs.filter((t) => t.terminalId !== null || isPaused(t));
  const paused = new Set(listed.filter(isPaused).map((t) => t.session.id));
  const clusters = orderAsTabs(
    listed
      .flatMap((t) => {
        const session = shown.get(entityKey(t.session));
        return session ? [{ repoRoot: session.repoRoot, groupId: view.groupState.groupOf[session.id] ?? '', item: session }] : [];
      }),
    (root) => projectGroups(root, view).map((g) => g.id),
    view.projectOrder,
  );
  // The strip has no group ROWS — each row carries its group as a chip — so a project's clusters are flattened back into one run, in the order the tab bar would have drawn them.
  const ordered = [...new Map(clusters.map((c) => [c.repoRoot, [] as SessionSummary[]])).keys()].map((repoRoot) => ({
    repoRoot,
    name: projName(repoRoot, view),
    items: clusters.filter((c) => c.repoRoot === repoRoot).flatMap((c) => c.items),
  }));
  return { ordered, paused };
}

/**
 * The strip's projects you hid, in its order, each with its roll-up, the one the switcher gives it: what the Hidden line counts and badges, and what its menu lists.
 * The roll-up is what makes hiding safe: a session waiting in a hidden project still reaches you, on the line, though its row is not listed.
 */
function hiddenProjects(model: SwitcherModel, ordered: StripProject[], view: View<'stripHidden'>): { project: StripProject; badge: NudgeStatus }[] {
  const badges = new Map(model.projects.map((project) => [project.repoRoot, project.badge]));
  return ordered.filter((project) => view.stripHidden.has(project.repoRoot)).map((project) => ({ project, badge: badges.get(project.repoRoot) ?? null }));
}

function renderStrip(model: SwitcherModel, pool: SessionSummary[], view: View<'sessions' | 'statuses' | 'backgroundTasks' | 'acked' |'groupState' | 'projectNames' | 'projectOrder' | 'tabs' | 'activeTab' | 'stripExpanded' | 'stripHidden'>): void {
  const { stripExpanded } = view;
  const overall = model.all.badge;
  stripBadge.className = badgeClass(overall);
  stripBadge.hidden = !overall;

  const { ordered, paused } = stripProjects(pool, view);
  // The line counts every row, hidden or not, as its badge rolls up every project: hiding changes what is listed, not what is summed up.
  const items = ordered.flatMap((g) => g.items);
  const total = items.length;
  const running = items.filter((s) => !paused.has(s.id));
  // "Needs you" is idle or waiting and NOT already read; busy is work in progress, which wants nothing from you, and a paused session wants nothing either, whatever status it still holds.
  const needing = running.filter((s) => asksForYou(sessionNudge(s.id, view))).length;

  if (total === 0) {
    // Gone entirely rather than sitting there saying "All clear", which read as odd on a first run — nothing had happened yet for anything to be clear of — and left a caret pointing at a panel that could not open.
    // Absent over inert is what the rest of the sidebar does: the group jump button is dropped below two targets, the filter status hides when nothing is filtering.
    // The stored stripExpanded is deliberately untouched: this is what there is to show, not a preference, and the strip must come back the way you left it.
    liveStrip.hidden = true;
    stripList.hidden = true;
    stripRows.clear();
    stripHeadings.clear();
    return;
  }

  liveStrip.hidden = false;
  stripToggle.setAttribute('aria-expanded', String(stripExpanded));
  stripLabel.textContent = stripLine(running.length, needing, total - running.length);
  stripList.hidden = !stripExpanded;
  // Once for the whole strip rather than per row: the membership and the registry have to come from the same read anyway.
  const { groups, groupOf } = view.groupState;
  // The session on show, which its row says, as the tab bar marks its tab and the list its row: without it the row you are already in looks like any other, and pressing it seems to do nothing.
  const onShow = tabOnShow(view)?.session.id;
  const hidden = hiddenProjects(model, ordered, view);
  placeChildren(stripList, [
    ...ordered
      .filter((project) => !view.stripHidden.has(project.repoRoot))
      .flatMap((project) => {
        const parts = stripHeadings.draw(project.repoRoot, buildHeading);
        updateHeading(parts, project, view);
        const rows = project.items.map((session) => {
          const row = stripRows.draw(entityKey(session), buildRow);
          const groupName = groups.find((g) => g.id === groupOf[entityKey(session)])?.name || undefined;
          updateRow(row, session, groupName, session.id === onShow, view);
          return row.row;
        });
        return [parts.heading, ...rows];
      }),
    ...(hidden.length > 0 ? [hiddenLine] : []),
  ]);
  hiddenLabel.textContent = `${hidden.length} ${hidden.length === 1 ? 'project' : 'projects'} hidden`;
  const hiddenNudge = strongestNudge(hidden.map(({ badge }) => badge));
  hiddenBadge.className = badgeClass(hiddenNudge);
  hiddenBadge.hidden = !hiddenNudge;
  // What this render did not draw is no longer running or paused as that session (stopped, unpaused, closed, or cleared into a new one), or left the pool (archived, being deleted), or its project has nothing left here.
  stripRows.sweep();
  stripHeadings.sweep();
}

// The strip follows, drawn by its own render (`refreshStrip`, told of it).
stripToggle.addEventListener('click', () => store.set({ stripExpanded: !store.get().stripExpanded }));

// The caret, from the same chevron as every other fold in the app.
stripToggle.querySelector('.strip-chev')!.innerHTML = chevronIcon('down', 11);

/** What the strip draws from the store. */
type StripView = View<'sessions' | 'statuses' | 'backgroundTasks' | 'acked' |'archived' | 'pendingDeletes' | 'groupState' | 'projectNames' | 'projectOrder' | 'tabs' | 'activeTab' | 'stripExpanded' | 'stripHidden'>;

/**
 * The strip follows the store, its line badged with the switcher's own roll-up (`switcherModel`) and its rows drawn from the switcher's pool.
 * A watcher the sidebar registers (watch.ts).
 */
export function refreshStrip(view: StripView): void {
  renderStrip(switcherModel(view), switcherPool(view), view);
}
