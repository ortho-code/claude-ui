import type { SessionSummary } from '../../../../shared/types';
import { byId, fromMarkup } from '../../../dom';
import { entityKey, orderAsTabs, sessionLabel, stopControlState, type SwitcherModel } from '../../../logic';
import { store, type View } from '../../../state/app';
import { projName, projectGroups, sessionNudge, switcherModel, switcherPool, tabOnShow, tabWith } from '../../../state/views';
import { ackOnClick, applyStatus, badgeClass } from '../../../statusdot';
import { chevronIcon, stopIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { hostOf } from '../builtin';
import '../../../menu-row.css';
import './live-strip.css';

/**
 * The live strip, at the foot of the sidebar: every running session, wherever it runs, under a line badged with the switcher's roll-up that folds the rows away.
 * A row jumps to its session, its dot marks it read, and its button stops it, each through the sidebar's host; the row of the session on show is marked; the fold is the store's (`stripExpanded`).
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
 * The strip row's stop control.
 *
 * WHY IT BELONGS HERE and is not just a shortcut for the tab's button: clicking a strip row calls `jumpToSession`, which is navigation — it switches the active project and activates the tab.
 * So stopping a stray session from the strip costs you your place: you go there, stop it, and come back.
 * This is the only way to act on a session in ANOTHER project without leaving the one you are looking at, which is the same gap the strip was built to close.
 * The membership rule makes it exact: the strip lists what has a PROCESS, which is precisely the set of things that can be stopped — so there is no scoping or filtering to reason about, and no cold-tab case.
 * STOP ONLY, never close: the strip is not a list of tabs.
 * A row leaves it by the session stopping, which is what this already does.
 */
function stripStopButton(session: SessionSummary, view: View<'tabs'>): HTMLButtonElement {
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'icon-btn compact strip-item-stop';
  stop.innerHTML = stopIcon(14);
  const tab = tabWith(session.id, view);
  // No tab at all should not happen — membership is "has a process", and a process belongs to a tab — so it is inert rather than guessed at.
  if (!tab) {
    stop.disabled = true;
    return stop;
  }
  const { disabled, tooltip, force } = stopControlState(tab);
  stop.innerHTML = stopIcon(14, force);
  stop.disabled = disabled;
  setTooltip(stop, tooltip);
  if (!disabled) {
    stop.addEventListener('click', (event) => {
      // The row around it jumps to the session; stopping must not also take you there.
      event.stopPropagation();
      hostOf('sessions').stopSession(session.id);
    });
  }
  return stop;
}

function renderStrip(model: SwitcherModel, pool: SessionSummary[], view: View<'statuses' | 'acked' | 'groupState' | 'projectNames' | 'projectOrder' | 'tabs' | 'activeTab' | 'stripExpanded'>): void {
  const { stripExpanded } = view;
  const overall = model.all.badge;
  stripBadge.className = badgeClass(overall);
  stripBadge.hidden = !overall;

  // What is RUNNING, wherever it is running — not what is nudging.
  // Membership used to be "has a live nudge", which meant marking a dot read deleted the row: muting said "erase this" when it should have said "seen it".
  // Running is also the only rule that closes the gap this strip exists for: scoped to one project, a live session in another is invisible in the tab bar (filtered to the active project) and out of scope in the list, and the switcher only ever gets you to a PROJECT, never back to a SESSION.
  // Nothing is lost by dropping the nudge from the membership: a session that is not running has already reported SessionEnd, so it cannot be nudging in the first place.
  // IN TAB ORDER, which is the only order here that nothing on disk can move — see orderAsTabs.
  // Driven from the tabs rather than from the session list on purpose: every row in this strip IS a live tab, and taking the order from the tabs array is what stops a session writing a message from swapping two rows you were reading.
  // The session data still comes from the list, so a row shows what the sidebar shows; only the ORDER is the tab bar's.
  const shown = new Map(pool.map((s) => [entityKey(s), s]));
  const clusters = orderAsTabs(
    view.tabs
      .filter((t) => t.terminalId !== null)
      .flatMap((t) => {
        const session = shown.get(entityKey(t.session));
        return session ? [{ repoRoot: session.repoRoot, groupId: view.groupState.groupOf[session.id] ?? '', item: session }] : [];
      }),
    (root) => projectGroups(root, view).map((g) => g.id),
    view.projectOrder,
  );
  // The strip has no group ROWS — each row carries its group as a chip — so a project's clusters are flattened back into one run, in the order the tab bar would have drawn them.
  const ordered = [...new Map(clusters.map((c) => [c.repoRoot, [] as SessionSummary[]])).keys()].map((repoRoot) => ({
    name: projName(repoRoot, view),
    items: clusters.filter((c) => c.repoRoot === repoRoot).flatMap((c) => c.items),
  }));
  const total = ordered.reduce((n, g) => n + g.items.length, 0);
  // "Needs you" is idle or waiting and NOT already read; busy is work in progress, which wants nothing from you.
  const needing = ordered.reduce(
    (n, g) => n + g.items.filter((s) => sessionNudge(s.id, view) === 'idle' || sessionNudge(s.id, view) === 'waiting').length,
    0,
  );

  if (total === 0) {
    // Gone entirely rather than sitting there saying "All clear", which read as odd on a first run — nothing had happened yet for anything to be clear of — and left a caret pointing at a panel that could not open.
    // Absent over inert is what the rest of the sidebar does: the group jump button is dropped below two targets, the filter status hides when nothing is filtering.
    // The stored stripExpanded is deliberately untouched: this is what there is to show, not a preference, and the strip must come back the way you left it.
    liveStrip.hidden = true;
    stripList.hidden = true;
    stripList.replaceChildren();
    return;
  }

  liveStrip.hidden = false;
  stripToggle.setAttribute('aria-expanded', String(stripExpanded));
  // Counting ATTENTION rather than rows: now that a session stays listed while it runs, a plain row count would report five sessions wanting you when four of them are working away happily.
  stripLabel.textContent = needing > 0 ? `${needing} of ${total} need you` : `${total} live`;
  stripList.hidden = !stripExpanded;
  // Once for the whole strip rather than per row: the membership and the registry have to come from the same read anyway.
  const { groups, groupOf } = view.groupState;
  // The session on show, which its row says, as the tab bar marks its tab and the list its row: without it the row you are already in looks like any other, and pressing it seems to do nothing.
  const onShow = tabOnShow(view)?.session.id;
  stripList.replaceChildren(
    ...ordered.flatMap((project) => {
      const heading = document.createElement('div');
      heading.className = 'strip-project';
      heading.textContent = project.name;
      const rows = project.items.map((session) => {
        // The row is a DIV holding two buttons rather than one button, because a button cannot contain a button and this row now has two things to do: jump to the session, or stop it.
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
        applyStatus(dot, view.statuses.get(session.id), view.acked.has(session.id));
        // A muted row stays LISTED: membership is "has a process", and acking says "seen it", not "stop".
        // Only the count above drops it.
        ackOnClick(dot, () => session.id);
        const name = document.createElement('span');
        name.className = 'strip-item-name';
        name.textContent = sessionLabel(session);
        jump.append(dot, name);
        // The group as a CHIP rather than a third level of headings.
        // The strip is capped at 40vh, where a project -> group -> session nesting costs a heading row and an indent per group, and a chip costs no rows at all.
        // Worth revisiting if several sessions of one group routinely show here together, since the same chip repeated down a run of rows reads as noise where a single heading would not.
        const groupName = groups.find((g) => g.id === groupOf[entityKey(session)])?.name;
        if (groupName) {
          const chip = document.createElement('span');
          chip.className = 'strip-item-group';
          chip.textContent = groupName;
          jump.append(chip);
        }
        setTooltip(jump, sessionLabel(session, '') || null);
        // The class is the stylesheet's, the menu row's fill for what is on show, which the switcher's entry on show wears too; the attribute is what a screen reader reads.
        if (session.id === onShow) {
          row.classList.add('active');
          jump.setAttribute('aria-current', 'true');
        }
        jump.addEventListener('click', () => hostOf('sessions').openSession(session.id));
        row.append(jump, stripStopButton(session, view));
        return row;
      });
      return [heading, ...rows];
    }),
  );
}

// The strip follows, drawn by its own render (`refreshStrip`, told of it).
stripToggle.addEventListener('click', () => store.set({ stripExpanded: !store.get().stripExpanded }));

// The caret, from the same chevron as every other fold in the app.
stripToggle.querySelector('.strip-chev')!.innerHTML = chevronIcon('down', 11);

/** What the strip draws from the store. */
type StripView = View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'groupState' | 'projectNames' | 'projectOrder' | 'tabs' | 'activeTab' | 'stripExpanded'>;

/**
 * The strip follows the store, its line badged with the switcher's own roll-up (`switcherModel`) and its rows drawn from the switcher's pool.
 * A watcher the sidebar registers (watch.ts).
 */
export function refreshStrip(view: StripView): void {
  renderStrip(switcherModel(view), switcherPool(view), view);
}
