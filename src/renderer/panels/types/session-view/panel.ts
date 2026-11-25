import { NOW, NOW_COUNTS } from '../../../rules/now';
import { sectionsOf } from '../../../rules/sectioned-view';
import { store } from '../../../state/app';
import { queryFacts, queryFields } from '../../../state/query-facts';
import { projName, switcherPool } from '../../../state/views';
import { element } from '../../../ui/dom';
import { onMinute } from '../../../ui/moments';
import type { MountedPanel, PanelHost, PanelView } from '../../contract';
import type { OptionsDecl } from '../../options';
import { DrawnRows, type FlatSection } from '../sessions/drawn';
import { drawFlat, type FlatLead } from '../sessions/flat';
import { markTabs, ROW_SLICES } from '../sessions/rows';
import './panel.css';

/**
 * A SESSION VIEW (docs/architecture/session-list.md § Now): a view with sections drawn as the session list's own rows, in a panel of its own, any number of them; `show` names the view, Now the only one so far.
 * It follows the store, as the sidebar does, rather than running anything, so its header has no Refresh.
 */

export const SESSION_VIEW_OPTIONS: OptionsDecl = { name: 'session-view', options: [{ name: 'show', kind: 'choice', values: [NOW.id] }], exactlyOne: [['show']] };

/** The scope its header switches between, All first, kept per panel as a list panel's view is. */
const VIEWS: PanelView[] = [
  { id: 'all', label: 'All projects', icon: 'tree' },
  { id: 'project', label: 'This project', icon: 'list' },
];

/** What a draw reads of the store: what its queries ask, what its rows draw, and the sessions and the scope. */
const DRAWN_FROM = [...new Set([...ROW_SLICES, 'sessions', 'tabs', 'pinned', 'finished', 'pendingDeletes', 'statuses', 'acked', 'setAside', 'kept', 'notes', 'groupState', 'projectNames', 'needsYou', 'needsYouTypes', 'prStatus', 'prNames', 'settings', 'activeProject', 'activeTab'] as const)];

/** What a section says in place of rows while This project is picked with no project on show. */
const NO_PROJECT = 'No project selected.';

export class SessionViewPanel implements MountedPanel {
  readonly el = element('div', 'panel-body session-view');
  private readonly list = element('div', 'session-view-list');
  private readonly drawn = new DrawnRows(false);
  private readonly stopWatching: () => void;
  private visible = false;
  /** The sections folded by a press on their heading, by id, for as long as the panel is mounted, as a list panel keeps its sections' folds. */
  private readonly folded = new Set<string>();

  constructor(private readonly host: PanelHost) {
    this.el.append(this.list);
    host.setViews(VIEWS);
    const stopStore = store.watch(DRAWN_FROM, () => this.draw(), { frame: true });
    // A session crosses into or out of a section with the clock alone, as a set-aside day comes, and a row's time moves.
    const stopClock = onMinute(() => this.draw());
    this.stopWatching = () => {
      stopStore();
      stopClock();
    };
    // Mounted hidden, it counts now, for its rail icon, though nothing shows it yet.
    this.draw();
  }

  /** The project `project:current` names: the one on show in This project, every project in All; undefined in This project with none on show. */
  private current(): string | null | undefined {
    if (this.host.view() !== 'project') return null;
    return store.get().activeProject ?? undefined;
  }

  /** Count the view's counted section, on show or not, since the count stands on its rail icon too; draw its sections only while the panel is on show, and a hidden panel when it is shown. */
  private draw(): void {
    const view = store.get();
    const current = this.current();
    const sections: FlatSection[] =
      current === undefined
        ? NOW.sections.filter((section) => !('inProject' in section)).map((section) => ({ id: section.id, heading: { name: section.name, count: 0, note: NO_PROJECT }, rows: [], lines: section.lines }))
        : sectionsOf(NOW, switcherPool(view), queryFields(view), queryFacts(view, Date.now(), current))
            .filter((section) => !section.inProject || current !== null)
            .map((section) => ({
              id: section.id,
              heading: { name: section.name, count: section.rows.length, note: section.rows.length === 0 ? (section.empty ?? null) : null },
              rows: section.rows,
              lines: section.lines,
              hides: section.hides,
              ...(section.folds ? { fold: { folded: this.folded.has(section.id), toggle: () => this.toggle(section.id) } } : {}),
            }));
    this.host.setCount(sections.find((section) => section.id === NOW_COUNTS)?.rows.length ?? 0);    if (!this.visible) return;
    drawFlat(this.drawn, this.list, sections, view, this.lead(current));
    markTabs(this.drawn, view);
  }

  /** Fold a section, or unfold it, and draw it so. */
  private toggle(id: string): void {
    if (!this.folded.delete(id)) this.folded.add(id);
    this.draw();
  }

  /** Where a row sits: its project, where the view shows every project or the row stands for one elsewhere. */
  private lead(current: string | null | undefined): FlatLead {
    return (shown, section) => (current === null || section.lines === 'compact' ? projName(shown.repoRoot, store.get()) : null);
  }

  refresh(): void {
    this.draw();
  }

  contextChanged(): void {
    this.draw();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.draw();
  }

  recheck(): void {}

  viewChanged(): void {
    this.draw();
  }

  unmount(): void {
    this.stopWatching();
  }
}
