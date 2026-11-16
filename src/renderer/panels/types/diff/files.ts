import type { DiffFile } from '../../../../shared/diff/types';
import { listCard, setFolded } from '../../../ui/card';
import { element } from '../../../ui/dom';
import { placeChildren, Keyed } from '../../../ui/keyed';
import type { Tone } from '../../../ui/tone';
import '../../../ui/tone.css';
import '../list.css';
import './files.css';

/**
 * The diff panel's list of changed files, flat or as a tree, in the compact row a list panel of changed files draws (list.css), so the two read alike.
 * A row is kept by its path, so a press on one survives a read that changes only its counts.
 * A folder of the tree folds as a list panel's row holding rows does: from its chevron, or a press anywhere on it, kept by its path in memory while the panel stays mounted.
 */

/** How the list is drawn, as the panel's views name them. */
export type FilesView = 'flat' | 'tree';

/** The colour a file's letter takes, from the words every lead takes (tone.css): changed, new, gone, moved. */
const TONE: Record<DiffFile['status'], Tone> = { M: 'attention', A: 'positive', U: 'positive', D: 'danger', R: 'normal' };

interface Row {
  card: HTMLElement;
  line: HTMLElement;
  lead: HTMLElement;
  title: HTMLElement;
  trail: HTMLElement;
  /** A folder's chevron. */
  fold: HTMLButtonElement;
}

/** A folder of the tree: the folders and files directly in it. */
interface Folder {
  folders: Map<string, Folder>;
  files: DiffFile[];
}

export class FileList {
  readonly el = element('div', 'list-body compact diff-files');
  private readonly rows = new Keyed<Row>((row) => row.card);
  /** The tree's folded folders, by path. */
  private readonly folded = new Set<string>();
  /** What was drawn last, which a fold draws again. */
  private drawn: { files: readonly DiffFile[]; view: FilesView; picked: string | null } = { files: [], view: 'flat', picked: null };
  /** The files' paths in the order their rows stand, folded ones left out. */
  private shown: string[] = [];

  /** `pick` is a press on a file's row. */
  constructor(private readonly pick: (path: string) => void) {}

  /** Draw `files` as `view` says, `picked` marked as the one on show, each row's place and words set again and nothing else rebuilt. */
  draw(files: readonly DiffFile[], view: FilesView, picked: string | null): void {
    this.drawn = { files, view, picked };
    this.shown = [];
    const placed = view === 'flat' ? files.map((file) => this.fileRow(file, 0, true)) : this.treeRows(files);
    placeChildren(this.el, placed);
    this.rows.sweep();
  }

  /** The files' paths in the order their rows stand, what stepping from file to file follows. */
  order(): readonly string[] {
    return this.shown;
  }

  private toggle(path: string): void {
    if (!this.folded.delete(path)) this.folded.add(path);
    this.draw(this.drawn.files, this.drawn.view, this.drawn.picked);
  }

  /** The tree's rows: each folder before what it holds, a chain of folders that each hold only the next one on one row, as a file tree compacts them, then the files. */
  private treeRows(files: readonly DiffFile[]): HTMLElement[] {
    const root: Folder = { folders: new Map(), files: [] };
    for (const file of files) {
      let at = root;
      for (const part of file.path.split('/').slice(0, -1)) {
        const next = at.folders.get(part) ?? { folders: new Map(), files: [] };
        at.folders.set(part, next);
        at = next;
      }
      at.files.push(file);
    }
    const out: HTMLElement[] = [];
    const walk = (folder: Folder, path: string, depth: number): void => {
      for (const [name, held] of [...folder.folders].sort(([a], [b]) => a.localeCompare(b))) {
        let label = name;
        let inner = held;
        for (let only = soleFolder(inner); only; only = soleFolder(inner)) {
          label = `${label}/${only[0]}`;
          inner = only[1];
        }
        const full = path ? `${path}/${label}` : label;
        out.push(this.folderRow(full, label, count(inner), depth));
        if (!this.folded.has(full)) walk(inner, full, depth + 1);
      }
      for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) out.push(this.fileRow(file, depth, false));
    };
    walk(root, '', 0);
    return out;
  }

  private folderRow(path: string, label: string, files: number, depth: number): HTMLElement {
    const row = this.rows.draw(`folder\n${path}`, () => {
      const built = this.build('diff-folder');
      built.card.classList.remove('still');
      built.fold.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(path);
      });
      built.card.addEventListener('click', () => this.toggle(path));
      return built;
    });
    const open = !this.folded.has(path);
    setFolded(row.fold, !open);
    row.fold.setAttribute('aria-expanded', String(open));
    row.fold.setAttribute('aria-label', open ? `Fold ${label}` : `Unfold ${label}`);
    row.card.style.setProperty('--depth', String(depth));
    // In the isolated span a file's name sits in too, or the row's right-to-left cut moves a leading dot, `.claude`, to its end.
    row.title.replaceChildren(span('list-text', label));
    row.title.title = path;
    row.trail.textContent = String(files);
    placeChildren(row.line, [row.fold, row.title, row.trail]);
    return row.card;
  }

  private fileRow(file: DiffFile, depth: number, flat: boolean): HTMLElement {
    const row = this.rows.draw(`file\n${file.path}`, () => {
      const built = this.build('diff-file');
      built.card.classList.remove('still');
      built.card.addEventListener('click', () => this.pick(file.path));
      return built;
    });
    this.shown.push(file.path);
    row.card.classList.toggle('picked', file.path === this.drawn.picked);
    row.card.setAttribute('aria-current', String(file.path === this.drawn.picked));
    row.card.style.setProperty('--depth', String(depth));
    row.lead.className = `list-lead tone-${TONE[file.status]}`;
    row.lead.textContent = file.status;
    row.title.replaceChildren(pathText(file.path, flat));
    row.title.title = file.from ? `${file.from} → ${file.path}` : file.path;
    row.trail.replaceChildren(...trailOf(file));
    placeChildren(row.line, [row.lead, row.title, row.trail]);
    return row.card;
  }

  private build(kind: string): Row {
    const { card, content, title } = listCard(`list-row still ${kind}`);
    const line = element('div', 'list-line');
    title.className = 'card-title cut-start';
    content.replaceChildren(line);
    const fold = element('button', 'icon-btn compact list-fold');
    fold.type = 'button';
    return { card, line, lead: element('span'), title, trail: element('span', 'list-trail'), fold };
  }
}

/** The one folder a folder holds when it holds that and nothing else, which the tree puts on its row. */
function soleFolder(folder: Folder): [string, Folder] | null {
  if (folder.files.length || folder.folders.size !== 1) return null;
  return [...folder.folders][0] ?? null;
}

/** A folder's count: every file under it. */
function count(folder: Folder): number {
  let n = folder.files.length;
  for (const held of folder.folders.values()) n += count(held);
  return n;
}

/** A span of `text` in the class given. */
function span(className: string, text: string): HTMLElement {
  const el = element('span', className);
  el.textContent = text;
  return el;
}

/** A file's name, after its folder, muted, in the flat list, where a column of paths then scans by name; the tree shows the name alone, its folder being the row above. */
function pathText(path: string, flat: boolean): HTMLElement {
  const cut = path.lastIndexOf('/');
  const text = element('span', 'list-text');
  if (flat && cut >= 0) text.append(span('diff-folder-part', path.slice(0, cut + 1)), path.slice(cut + 1));
  else text.textContent = path.slice(cut + 1);
  return text;
}

/** What a row says at its end: the lines it adds and those it removes, each only when there are any, `new` for an untracked file, whose every line is new, or `binary` for a file with no lines to count. */
function trailOf(file: DiffFile): Node[] {
  if (file.binary) return [document.createTextNode('binary')];
  if (file.status === 'U') return [span('diff-added', 'new')];
  const parts = [...(file.added ? [span('diff-added', `+${file.added}`)] : []), ...(file.deleted ? [span('diff-deleted', `−${file.deleted}`)] : [])];
  return parts.flatMap((part, at) => (at ? [document.createTextNode(' '), part] : [part]));
}
