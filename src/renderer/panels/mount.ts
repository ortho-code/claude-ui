import { keptOver } from '../../shared/sessions/kept';
import { store } from '../state/app';
import { badgeClass } from '../status/status-dot';
import { element } from '../ui/dom';
import { PINNED_BADGE_ICON, WORKTREE_ICON } from '../ui/svg';
import { copyText } from '../ui/toast';
import { setTooltip } from '../ui/tooltip';
import type { MountedPanel, PanelHost, PanelType, PanelView } from './contract';
import { actionButton, drawFullScreenButton, showStatus } from './headers';
import type { PanelSlot } from './layout';
import { linkedSessions, pickSession, sessionNamed, startSession } from './links';
import { optionsOf } from './options';
import { SNAPSHOT_SLICES, snapshotText } from './snapshot';
import { HeaderTabs } from './tabs';
import type { TreeHost } from './tree';
import { keep, stateOf } from './tree-state';
import { viewButton } from './view-switch';

/** A panel on screen, and the marks it reports through — made once with it, so a rebuilt header or rail shows the same marks rather than orphaning them. */
export interface Mounted {
  panel: MountedPanel;
  /** Its entry as the layout says it now, which an edit that does not mount the panel afresh (its `view`, its title) still changes. */
  slot: PanelSlot;
  /** What is wrong with its entry's `view` that only its views show, for its group's note line. */
  viewNotes: string[];
  /** The view picked for it as its host answers it now (`PanelHost.view`), and as the panel was last told of it, at its mount or by `viewChanged`. */
  view: () => string | null;
  viewTold: string | null;
  /** Its type and declared parameters: a change to either mounts it afresh, a change to anything else (title, icon) does not. */
  signature: string;
  busy: HTMLElement;
  end: HTMLElement;
  /** The switch between the views it offers, empty and hidden with fewer than two. */
  views: HTMLElement;
  /** Its tabs, drawn in its header in place of its title, while it says it has them (`setTabs`). */
  tabs: HeaderTabs | null;
  action: HTMLButtonElement | null;
  /** The dot on its rail icon (P8). */
  badge: HTMLElement;
  /** The count it reports, twice, since one element cannot stand in two places: beside the header's title, and on its rail icon. */
  count: HTMLElement;
  railCount: HTMLElement;
  /** The count as last reported, for the rail's label, which says it whole where the badge cannot. */
  countValue: number | null;
  /** The folder it looks in, beside its title, while it names one (`setFolder`). */
  folder: HTMLElement;
  /** Why the panel says it cannot run, as it last reported: drawn in its place, with `alert` on its rail icon. */
  problems: string[];
  /** What the panel says about itself that does not stop it, for its group's note line. */
  notes: string[];
  /** Its full-screen button, in the header the tree draws, or in a bare panel's own bar (`PanelHost.fullScreenButton`). */
  fullScreenButton: HTMLButtonElement;
}

/** What mounting a panel needs of the tree that places it. */
export interface MountContext {
  host: TreeHost;
  /** The type a slot names. */
  typeOf(name: string): PanelType;
  /** What a slot is mounted as (`Mounted.signature`). */
  signatureOf(slot: PanelSlot): string;
  /** The panel mounted under `key` as it is now, which is none until its mount is done: a report it makes while mounting is held for it until then. */
  entry(key: string): Mounted | undefined;
  /** Draw again once the current task is done. */
  queueRender(): void;
  /** Put the panel `key` full screen, or back to the layout when it is. */
  toggleFullScreen(key: string): void;
  bringIntoView(key: string): void;
}

/** The folder a panel looks in, beside its title: the worktree mark and the checkout's name, in the badge a session row wears, and the star of a pin while that checkout was picked for the session rather than followed. */
function folderMark(): { element: HTMLElement; set: PanelHost['setFolder'] } {
  const folder = element('span', 'panel-folder');
  const folderIcon = element('span', 'badge-icon');
  folderIcon.innerHTML = WORKTREE_ICON;
  const folderName = element('span', 'badge-text');
  const folderPicked = element('span', 'badge-icon panel-folder-picked');
  folderPicked.innerHTML = PINNED_BADGE_ICON;
  folder.append(folderIcon, folderName, folderPicked);
  folder.hidden = true;
  // In place, as the count is: the element stands in the header whatever it says.
  const set: PanelHost['setFolder'] = (named) => {
    folder.hidden = named === null;
    if (!named) return;
    folder.classList.toggle('main', !named.worktree);
    folderIcon.hidden = !named.worktree;
    folderName.textContent = named.name;
    folderPicked.hidden = !named.picked;
    setTooltip(folder, named.picked ? `${named.path}\nPicked from the session's worktree list; Follow the session there lets go` : named.path);
  };
  return { element: folder, set };
}

/** The switch between a panel's views, and the view picked for it: on this machine, else its entry's, kept against the views it last said it offers. */
function viewSwitch(slot: PanelSlot, context: MountContext): { element: HTMLElement; picked: () => string | null; show: (offered: PanelView[]) => void; keep: (id: string) => void; notes: () => string[] } {
  // The switch between the panel's views, drawn again only when what it would say changes, so a press on one of its buttons survives a run that offers the same views.
  const views = element('span', 'panel-views');
  views.hidden = true;
  let viewsSaid = '';
  // The entry as the layout says it now, not as it was when the panel mounted: an edit of its `view` alone does not mount it afresh.
  const entryView = (): string | null => (context.entry(slot.key)?.slot ?? slot).view;
  // The view picked on this machine, else the entry's; the switch marks it when the panel offers it, else the panel's first.
  const pickedView = (): string | null => stateOf(slot.key)?.view ?? entryView();
  // The views the panel last said it offers, which a pick is kept against, and what its views say of its entry, held here while it is still mounting, as its other reports are in `mountPanel`, so a note said from its mount is not lost.
  let offeredNow: PanelView[] = [];
  let viewNotesNow: string[] = [];
  // Kept as a group's pick is: only where it differs from what the entry says, or from the panel's first when the entry says nothing.
  // The panel made the pick itself, so it is not told of it again (`viewChanged`).
  const keepPick = (id: string): void => {
    keep([{ id: slot.key, field: 'view', value: keptOver(id, entryView() ?? offeredNow[0]?.id ?? id) }]);
    const current = context.entry(slot.key);
    if (current) current.viewTold = pickedView();
    showViews(offeredNow);
  };
  const showViews = (offered: PanelView[]): void => {
    offeredNow = offered;
    const shown = offered.find(({ id }) => id === pickedView())?.id ?? offered[0]?.id;
    // An entry naming a view its list does not offer is said under the group, as an icon this build does not have is; only the list's views can tell.
    const named = entryView();
    const notes = named !== null && offered.length > 0 && !offered.some(({ id }) => id === named) ? [`view "${named}" on ${slot.key} is not one of the views its list offers (${offered.map(({ id }) => id).join(', ')}); its first is shown until another is picked.`] : [];
    viewNotesNow = notes;
    const current = context.entry(slot.key);
    if (current && current.viewNotes.join('\n') !== notes.join('\n')) {
      current.viewNotes = notes;
      context.queueRender();
    }
    const now = JSON.stringify([offered, shown]);
    if (now === viewsSaid) return;
    viewsSaid = now;
    views.hidden = offered.length < 2;
    views.replaceChildren(
      ...(offered.length < 2
        ? []
        : offered.map((view) =>
            viewButton(view, view.id === shown, () => {
              keepPick(view.id);
              context.entry(slot.key)?.panel.refresh();
            }),
          )),
    );
  };
  return { element: views, picked: pickedView, show: showViews, keep: keepPick, notes: () => viewNotesNow };
}

/** Mount the panel for a slot, with its header's marks and controls and the host it reports through. */
export function mountPanel(slot: PanelSlot, context: MountContext): Mounted {
  const type = context.typeOf(slot.type!);
  const busy = element('span', 'nudge running');
  busy.hidden = true;
  const end = element('span', 'panel-end');
  // Per entry, since what the button would do can depend on the options; a terminal has none.
  const label = type.bare ? null : type.actionLabel ? type.actionLabel(optionsOf(slot.entry)) : 'Refresh';
  const action = label === null ? null : actionButton(label);
  const fullScreenButton = element('button', 'icon-btn full-screen-toggle');
  fullScreenButton.type = 'button';
  // A bare panel's own bar sizes it with its other buttons; the tree's header takes the compact box its Refresh has.
  if (!type.bare) fullScreenButton.classList.add('compact');
  fullScreenButton.addEventListener('click', () => context.toggleFullScreen(slot.key));
  drawFullScreenButton(fullScreenButton, false);
  const badge = element('span', badgeClass(null));
  badge.hidden = true;
  const count = element('span', 'panel-count');
  const railCount = element('span', 'rail-count');
  count.hidden = railCount.hidden = true;
  const folder = folderMark();
  const views = viewSwitch(slot, context);
  // What the panel reports about itself, held here so a report made while it is still mounting is not lost; a change re-renders, since both the panel's place and its rail icon draw from it.
  const said = { problems: [] as string[], notes: [] as string[] };
  const report = (field: keyof typeof said, lines: string[]): void => {
    if (lines.join('\n') === said[field].join('\n')) return;
    said[field] = lines;
    const current = context.entry(slot.key);
    if (current) current[field] = lines;
    context.queueRender();
  };
  // Built on the first call that has tabs and kept from then on, so a panel that says none for a while and then some again keeps its tabs' elements; only having tabs or not changes the header, which a render draws.
  let headerTabs: HeaderTabs | null = null;
  /** The tabs as on show in the header now, null while the panel says it has none. */
  let tabsOn: HeaderTabs | null = null;
  const panelHost: PanelHost = {
    where: () => context.host.where(),
    view: views.picked,
    setViews: views.show,
    pickView: views.keep,
    setTabs: (tabs) => {
      if (tabs) {
        headerTabs ??= new HeaderTabs();
        headerTabs.draw(tabs);
      }
      const now = tabs ? headerTabs : null;
      if (now === tabsOn) return;
      tabsOn = now;
      const current = context.entry(slot.key);
      if (current) current.tabs = now;
      context.queueRender();
    },
    setBusy: (on) => {
      busy.hidden = !on;
    },
    setEnd: (label) => {
      end.textContent = label;
    },
    setStatus: (status, look) => showStatus(badge, status, look),
    setCount: (value) => {
      const current = context.entry(slot.key);
      if (current?.countValue === value) return;
      if (current) current.countValue = value;
      count.hidden = railCount.hidden = value === null;
      count.textContent = value === null ? '' : String(value);
      // Two digits at most under a 24px icon; the rail's label, rebuilt by the render below, says the number whole.
      railCount.textContent = value === null ? '' : value > 99 ? '99+' : String(value);
      context.queueRender();
    },
    setProblems: (problems) => report('problems', problems),
    setNotes: (notes) => report('notes', notes),
    setFolder: folder.set,
    // The session links are remembered under the panel's own entry key.
    startSession: (request) => void startSession(slot.key, request, context.host.asks),
    linkedSessions: (itemKey) => linkedSessions(slot.key, itemKey),
    session: sessionNamed,
    pickSession: (anchor, sessions) => pickSession(anchor, sessions, context.host.asks),
    copyText: (text, confirmation) => void copyText(text, confirmation),
    sessionsSnapshot: snapshotText,
    watchSessions: (listener) => store.watch(SNAPSHOT_SLICES, listener),
    fullScreenButton,
    bringIntoView: () => context.bringIntoView(slot.key),
    ...context.host.asks,
  };
  const panel = type.mount(slot, panelHost);
  action?.addEventListener('click', () => panel.refresh());
  // A panel that said its tabs while it was mounting has them from the start.
  return { panel, slot, viewNotes: views.notes(), view: views.picked, viewTold: views.picked(), signature: context.signatureOf(slot), busy, end, views: views.element, tabs: tabsOn, action, badge, count, railCount, countValue: null, folder: folder.element, fullScreenButton, ...said };
}
