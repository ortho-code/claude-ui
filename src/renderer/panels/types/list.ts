import type { PanelSlot } from '../layout';
import { optionsOf } from '../options';
import { prepare, type MountedPanel, type PanelHost, type PanelType, type Prepared } from './command';
import type { FolderType } from './folder';

/**
 * The `list` kind: a type from the config folder whose script prints a list, which the app draws.
 */

class ListPanel implements MountedPanel {
  readonly el = document.createElement('div');
  private disposed = false;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
    private readonly type: PanelType,
    private readonly folder: FolderType,
  ) {
    this.el.className = 'panel-body';
    host.setNotes(folder.notes);
    void this.check();
  }

  refresh(): void {
    void this.check();
  }

  contextChanged(): void {}

  setVisible(): void {}

  recheck(): void {
    void this.check();
  }

  unmount(): void {
    this.disposed = true;
  }

  /**
   * What is wrong with the type or the entry, told to the host, and where the panel would run when nothing is.
   * The manifest first, since nothing else can be checked against a manifest that is not sound; then the entry's options and the script, together, so one look says all there is to fix.
   */
  private async check(): Promise<Prepared | null> {
    const { manifest } = this.folder;
    if (!manifest) {
      this.host.setProblems(this.folder.problems);
      return null;
    }
    const [prepared, script] = await Promise.all([
      prepare(optionsOf(this.slot.entry), this.type, this.host.where()),
      window.claudeUi.checkPath(manifest.run, { dir: this.folder.dir }, 'executable'),
    ]);
    if (this.disposed) return null;
    const problems = [...prepared.problems, ...(script.problem ? [`types/${this.folder.name}: run ${script.problem}.`] : [])];
    this.host.setProblems(problems);
    return problems.length === 0 ? prepared : null;
  }
}

/** Mount a panel of a `list` type, or of a type whose manifest is not sound, which says why in its place. */
export function mountList(slot: PanelSlot, host: PanelHost, type: PanelType, folder: FolderType): MountedPanel {
  return new ListPanel(slot, host, type, folder);
}
