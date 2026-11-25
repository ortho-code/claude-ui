import type { EditorUi } from '../../../../shared/types';
import { allTabs, changeEditorGroup, changeEditorTabs, editorSetKey, editorTabsOnShow, EVEN_SHARE, focusedOn, groupOf, keyOf, NO_GROUP, NO_TABS, sharedAs, shownTab, steppedIn, updated, type EditorTabs, type FileRef } from '../../../state/editor-tabs';
import { store } from '../../../state/app';
import { element } from '../../../ui/dom';
import { placeChildren } from '../../../ui/keyed';
import { closeIcon } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import { drawDockButton } from '../../headers';
import { FileDoc, type Doc, type DocHost } from './file/doc';
import { SessionDoc } from './file/session-doc';
import { groupDivider, shareWidth } from './divider';
import { EditorGroupView } from './group';
import './view.css';

/** A group's width from which Fit draws a diff split. */
const WIDE_PX = 600;
/** The head's close button's label and tooltip. */
const CLOSE_ALL = 'Close all files';

/**
 * THE EDITOR'S VIEW, one for the window: the files open for the tab on show, drawn by group (group.ts), each with its tabs in a head of its own and the one on show below them; two groups stand side by side with a divider between them, and the Editor's own buttons sit at the end of the last group's head.
 * A press anywhere in a group, or the keys reaching it, makes it the one last pressed, whose file is the one on show.
 * Built apart from the layout, so it can be shown in the drawer over the terminal area or docked in the Editor panel (controller.ts places it); it reads the same wherever it is.
 * What is open lives in the store, one set per session, so a switch of session tabs, a move between drawer and dock, or a layout change draws it again from there; each open file is a `Doc`, kept while its tab stays in the set on show.
 * How a diff is drawn (the view, whitespace, Changes only) is the window's `editorUi`, kept for the next launch.
 */
export class EditorView {
  readonly el = element('div', 'editor-view');
  /** A view per group drawn, the first always there. */
  private readonly groups: EditorGroupView[] = [];
  private readonly divider = groupDivider(
    () => {
      const [first, second] = this.groups;
      return first && second ? [first.el, second.el] : null;
    },
    (share) => changeEditorTabs((set) => sharedAs(set, share ?? EVEN_SHARE)),
  );
  private readonly resized = new ResizeObserver(() => this.measure());
  /** Docks the Editor beside the terminal, or puts it back in the drawer, its icon saying which, as the full-screen button's does; there only while the layout has an Editor panel to dock in. */
  private readonly dockButton = element('button', 'icon-btn compact editor-dock');
  /** Closes every file of the tab on show at once, docked or in the drawer, where Esc and a press on claude only close the drawer and keep them. */
  private readonly closeButton = element('button', 'icon-btn compact editor-close');
  /** The docked Editor panel's full-screen button, placed before Close all files while it is docked; null otherwise. */
  private fullScreen: HTMLButtonElement | null = null;
  private readonly docs = new Map<string, Doc>();
  /** What each file's tab was last told about its group's width, so one drawn for the other side of `WIDE_PX` is drawn again. */
  private readonly drawnWide = new Map<string, boolean>();
  /** The set last drawn, so a store change that leaves it alone draws nothing. */
  private drawn: { key: string; set: EditorTabs } | null = null;

  /** `putInSight` brings the Editor into view where it stands, docked or in the drawer, for a file just opened in it. */
  constructor(private readonly putInSight: () => void) {
    this.dockButton.type = 'button';
    this.dockButton.addEventListener('click', () => this.toggleDock());
    this.closeButton.type = 'button';
    this.closeButton.innerHTML = closeIcon(14);
    this.closeButton.setAttribute('aria-label', CLOSE_ALL);
    setTooltip(this.closeButton, CLOSE_ALL);
    this.closeButton.addEventListener('click', () => changeEditorTabs(() => NO_TABS));
    // Esc closes the drawer it is in, as it closes the history; docked, there is nothing to close.
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || this.picks().docked) return;
      event.preventDefault();
      store.set({ editorDrawer: false });
    });
    store.watch(['editorTabs', 'tabs', 'activeTab', 'editorAsked'], () => {
      this.draw();
      this.reveal();
    });
    store.watch(['editorUi', 'editorDock'], (view, before) => {
      if (view.editorUi.ignoreWs !== before.editorUi.ignoreWs) for (const doc of this.docs.values()) doc.view.reload();
      else for (const doc of this.docs.values()) doc.view.redraw();
      this.drawHead();
    });
    this.draw();
  }

  /** Place the docked Editor panel's full-screen button before Close all files, or take it out with null; the same button again leaves it where it is, so a press on it survives the draw its own press starts. */
  setFullScreenButton(button: HTMLButtonElement | null): void {
    if (button === this.fullScreen) return;
    this.fullScreen?.remove();
    this.fullScreen = button;
    this.groups.at(-1)?.holdControls(this.controls());
  }

  /** The Editor's own buttons, in their order in the last group's head; Close all files stays the last. */
  private controls(): HTMLElement[] {
    return [this.dockButton, ...(this.fullScreen ? [this.fullScreen] : []), this.closeButton];
  }

  private picks(): EditorUi {
    return store.get().editorUi;
  }

  private pick(change: Partial<EditorUi>): void {
    store.set({ editorUi: { ...this.picks(), ...change } });
  }

  /** Dock it, or put it back in the drawer, which it then opens in; docked, the drawer is closed, so it does not open on its own if the panel it docks in goes. */
  private toggleDock(): void {
    const docked = !this.picks().docked;
    store.set({ editorUi: { ...this.picks(), docked }, editorDrawer: !docked });
  }

  /** Give the keys to the file on show, so `j` and `k` step through it at once. */
  focus(): void {
    const shown = shownTab(editorTabsOnShow());
    if (shown) this.docs.get(shown.key)?.view.focus();
  }

  private drawHead(): void {
    const { editorDock, editorUi } = store.get();
    this.dockButton.hidden = !editorDock;
    drawDockButton(this.dockButton, editorUi.docked);
  }

  /** Measure each group against `WIDE_PX`; under Fit, a file drawn for the other side of it, by its group's width changing or by moving to the other group, is drawn again. */
  private measure(): void {
    const set = editorTabsOnShow();
    const fit = this.picks().view === 'fit';
    this.groups.forEach((group, index) => {
      group.wide = group.el.clientWidth >= WIDE_PX;
      if (!fit) return;
      for (const tab of set.groups[index]?.tabs ?? []) {
        const drawn = this.drawnWide.get(tab.key);
        if (drawn !== undefined && drawn !== group.wide) this.docs.get(tab.key)?.view.redraw();
      }
    });
  }

  /** Draw the set of the tab on show: each group's tabs and its file on show, side by side, the docs of tabs that left it let go. */
  private draw(): void {
    this.drawHead();
    const key = editorSetKey();
    const set = editorTabsOnShow();
    if (this.drawn?.key === key && this.drawn.set === set) return;
    this.drawn = { key, set };
    for (const [docKey, doc] of this.docs) {
      if (allTabs(set).some((tab) => tab.key === docKey)) continue;
      doc.release();
      this.docs.delete(docKey);
      this.drawnWide.delete(docKey);
    }
    const groups = set.groups.length > 0 ? set.groups : [NO_GROUP];
    this.placeGroups(groups.length);
    const split = groups.length > 1;
    this.el.classList.toggle('split', split);
    groups.forEach((group, index) => {
      const view = this.groups[index]!;
      view.el.classList.toggle('focused', split && index === set.focused);
      const active = group.tabs.find((tab) => tab.key === group.active);
      view.draw(group, active ? this.docOf(active.key, active.ref).view.el : null, split);
    });
    shareWidth(this.groups[0]!.el, this.groups[1]?.el ?? null, split ? set.share : null);
    this.measure();
  }

  /** Keep `count` group views in the window, the divider between two, and the Editor's own buttons in the last one's head. */
  private placeGroups(count: number): void {
    while (this.groups.length < count) {
      const group = new EditorGroupView();
      const index = this.groups.length;
      // Any press in a group, on a tab or in its file, makes it the one last pressed, and so do the keys reaching it, as Tab moves them.
      const pressed = (): void => changeEditorTabs((set) => focusedOn(set, index));
      group.el.addEventListener('pointerdown', pressed, { capture: true });
      group.el.addEventListener('focusin', pressed);
      this.resized.observe(group.el);
      this.groups.push(group);
    }
    for (const gone of this.groups.splice(count)) {
      this.resized.unobserve(gone.el);
      gone.release();
      gone.el.remove();
    }
    const els = this.groups.map((group) => group.el);
    placeChildren(this.el, count > 1 ? [els[0]!, this.divider, ...els.slice(1)] : els);
    this.groups.at(-1)!.holdControls(this.controls());
  }

  /** Put a file just opened in sight, hand a line asked to be brought into sight to the tab on show when it is the tab it was asked for, and clear the ask, so it is taken once. */
  private reveal(): void {
    const asked = store.get().editorAsked;
    if (!asked) return;
    store.set({ editorAsked: null });
    this.putInSight();
    if (asked.line !== null && shownTab(editorTabsOnShow())?.key === asked.key) this.docs.get(asked.key)?.view.revealLine(asked.line);
  }
  /** The doc of the tab `key`, made for `ref`'s kind: the one it has, showing `ref`, unless the same file is opened again as the other kind, as after git started or stopped ignoring it, or after its checkout could not be read. */
  private docOf(key: string, ref: FileRef): Doc {
    const found = this.docs.get(key);
    if (found?.kind === ref.kind) {
      void found.showRef(ref);
      return found;
    }
    found?.release();
    const host = this.docHost((): Doc => doc);
    const doc: Doc = ref.kind === 'checkout' ? new FileDoc(ref, host) : new SessionDoc(ref, host);
    this.docs.set(key, doc);
    return doc;
  }

  /** What a tab asks of the Editor; `doc` is the tab asking, once it is made. */
  private docHost(doc: () => Doc): DocHost {
    return {
      picks: () => this.picks(),
      wide: () => {
        const key = this.keyOfDoc(doc());
        if (key === undefined) return false;
        const wide = this.groups[groupOf(editorTabsOnShow(), key)]?.wide ?? false;
        this.drawnWide.set(key, wide);
        return wide;
      },
      pick: (change) => this.pick(change),
      step: (next) => {
        const now = this.keyOfDoc(doc());
        if (now === undefined) return;
        this.docs.delete(now);
        this.drawnWide.delete(now);
        // A file with a tab of its own already is put on show in that tab, and this one goes (`stepped`); else this doc moves to the new file's key, so the draw that follows finds it there, showing that file already.
        if (this.docs.has(keyOf(next))) doc().release();
        else this.docs.set(keyOf(next), doc());
        changeEditorTabs((set) => steppedIn(set, now, next));
      },
      refreshed: (next) => {
        const now = this.keyOfDoc(doc());
        if (now !== undefined) changeEditorGroup(now, (group) => updated(group, now, next));
      },
    };
  }

  private keyOfDoc(doc: Doc): string | undefined {
    return [...this.docs].find(([, each]) => each === doc)?.[0];
  }
}
