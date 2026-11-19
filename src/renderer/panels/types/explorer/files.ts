import type { DiffFile } from '../../../../shared/diff/types';
import type { ChangesRead } from '../../checkout-reads';
import type { ExplorerRoot } from './roots';
import { listCard, setFolded } from '../../../ui/card';
import { WORKTREE_ICON } from '../../../ui/svg';
import { element } from '../../../ui/dom';
import { flash } from '../../../ui/flash';
import { placeChildren, Keyed } from '../../../ui/keyed';
import type { Tone } from '../../../ui/tone';
import '../../../ui/tone.css';
import '../../../ui/members-rail.css';
import '../list.css';
import './files.css';

/**
 * The Explorer's list of changed files, a section per root, flat or as a tree, in the compact row a list panel of changed files draws (list.css), so the two read alike.
 * Each root is a row of its own, its folder's name, then the branch it has out where that is not the folder's own name, and its count, its files under it inside an index line, as a custom group's sessions sit in the session list; a root its roots say starts folded does so the first time it is seen so.
 * A row is kept by its root and path, so a press on one survives a read that changes only its counts.
 * A root or a folder of the tree folds as a list panel's row holding rows does: from its chevron, or a press anywhere on it, kept by its path in memory while the panel stays mounted.
 */

/** How soon a second press on the same row counts as a double click, about what a desktop's own setting defaults to. */
const DOUBLE_CLICK_MS = 500;

/** How the list is drawn, as the panel's views name them. */
export type FilesView = 'flat' | 'tree';

/** One root as the list draws it: the root, and its latest read, none before the first. */
export interface RootSection {
  root: ExplorerRoot;
  read: ChangesRead | undefined;
}

/** A file of the list, by the root it is in and its path there. */
export interface Placed {
  root: string;
  path: string;
}

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
  readonly el = element('div', 'list-body compact explorer-files');
  private readonly rows = new Keyed<Row>((row) => row.card);
  /** Each root's block of rows, inside its index line, by the root's path. */
  private readonly blocks = new Keyed<HTMLElement>((block) => block);
  /** The folded roots and folders of the tree, by root and path, a root's own path empty. */
  private readonly folded = new Set<string>();
  /** The roots seen so far, each with whether it starts folded, so a root is folded or opened as it starts only when first seen so: a checkout listed open for one session and as the folded main checkout for another starts as each says. */
  private readonly seen = new Set<string>();
  /** What was drawn last, which a fold draws again. */
  private drawn: { sections: readonly RootSection[]; view: FilesView; picked: Placed | null } = { sections: [], view: 'flat', picked: null };
  /** The files in the order their rows stand, folded ones left out. */
  private shown: Placed[] = [];

  /** The last press on a file's row, so a second one on it soon after counts as a double click. */
  private lastPress: { key: string; at: number } | null = null;

  /** `pick` is a press on a file's row, `keep` set for a double click. */
  constructor(private readonly pick: (file: Placed, keep: boolean) => void) {}

  /**
   * A press on a file's row, or the second of a double click on it.
   * Told apart here rather than by the browser's `dblclick`: the first press can open the Editor, which moves the list as the layout makes room, and a row moved between the two presses gets no `dblclick`.
   */
  private press(file: Placed, event: MouseEvent): void {
    // When the press happened, not when it was handled: the first press's own work can hold the second one's handler back.
    const now = event.timeStamp;
    const key = `${file.root}\n${file.path}`;
    const second = this.lastPress?.key === key && now - this.lastPress.at < DOUBLE_CLICK_MS;
    this.lastPress = second ? null : { key, at: now };
    this.pick(file, second);
  }

  /** Draw `sections` as `view` says, `picked` marked as the one on show, each row's place and words set again and nothing else rebuilt. */
  draw(sections: readonly RootSection[], view: FilesView, picked: Placed | null): void {
    this.drawn = { sections, view, picked };
    this.shown = [];
    const placed: HTMLElement[] = [];
    for (const { root, read } of sections) {
      const sighting = `${root.path}\n${root.folded}`;
      if (!this.seen.has(sighting)) {
        this.seen.add(sighting);
        if (root.folded) this.folded.add(foldKey(root.path, ''));
        else this.folded.delete(foldKey(root.path, ''));
      }
      const files = read?.kind === 'summary' ? read.summary.files : [];
      placed.push(this.rootRow(root, read));
      if (this.folded.has(foldKey(root.path, ''))) continue;
      const block = this.blocks.draw(root.path, () => element('div', 'members-rail explorer-members'));
      placeChildren(block, view === 'flat' ? files.map((file) => this.fileRow(root.path, file, 0, true)) : this.treeRows(root.path, files));
      placed.push(block);
    }
    placeChildren(this.el, placed);
    this.rows.sweep();
    this.blocks.sweep();
  }

  /** The files in the order their rows stand, what stepping from file to file follows. */
  order(): readonly Placed[] {
    return this.shown;
  }

  /** Bring a root's row to the top of the list, unfolded, and flash it, as a jump to a group does in the session list. */
  reveal(rootPath: string): void {
    const key = foldKey(rootPath, '');
    if (this.folded.delete(key)) this.draw(this.drawn.sections, this.drawn.view, this.drawn.picked);
    const row = this.rows.find(`explorer-root\n${key}`);
    if (!row) return;
    // Only the list scrolls, as the session list's jump scrolls only the list.
    this.el.scrollTop += row.card.getBoundingClientRect().top - this.el.getBoundingClientRect().top;
    flash(row.card);
  }

  private toggle(key: string): void {
    if (!this.folded.delete(key)) this.folded.add(key);
    this.draw(this.drawn.sections, this.drawn.view, this.drawn.picked);
  }

  /** A root's row: its folder's name, then its branch where that is not the folder's own name, and its count at the end; a read git refused says so in place of the count. */
  private rootRow(root: ExplorerRoot, read: ChangesRead | undefined): HTMLElement {
    const name = root.path.slice(root.path.lastIndexOf('/') + 1) || root.path;
    const row = this.foldingRow('explorer-root', foldKey(root.path, ''), name, 0);
    row.card.classList.toggle('shared', root.reason === 'shared');
    row.title.replaceChildren(span('list-text', name));
    row.title.title = root.path;
    row.trail.replaceChildren(...rootTrail(read));
    const mark = branchMark(read, name);
    placeChildren(row.line, mark ? [row.fold, row.title, mark, row.trail] : [row.fold, row.title, row.trail]);
    return row.card;
  }

  /** A root's tree: each folder before what it holds, a chain of folders that each hold only the next one on one row, as a file tree compacts them, then the files. */
  private treeRows(rootPath: string, files: readonly DiffFile[]): HTMLElement[] {
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
        out.push(this.folderRow(rootPath, full, label, count(inner), depth));
        if (!this.folded.has(foldKey(rootPath, full))) walk(inner, full, depth + 1);
      }
      for (const file of [...folder.files].sort((a, b) => a.path.localeCompare(b.path))) out.push(this.fileRow(rootPath, file, depth, false));
    };
    walk(root, '', 0);
    return out;
  }

  private folderRow(rootPath: string, path: string, label: string, files: number, depth: number): HTMLElement {
    const row = this.foldingRow('explorer-folder', foldKey(rootPath, path), label, depth);
    // In the isolated span a file's name sits in too, or the row's right-to-left cut moves a leading dot, `.claude`, to its end.
    row.title.replaceChildren(span('list-text', label));
    row.title.title = path;
    row.trail.textContent = String(files);
    placeChildren(row.line, [row.fold, row.title, row.trail]);
    return row.card;
  }

  /** A row that folds what it holds, a root's or a folder's, kept by `key`: its chevron and a press anywhere on it fold and unfold it, and it says which it would do. */
  private foldingRow(kind: string, key: string, label: string, depth: number): Row {
    const row = this.rows.draw(`${kind}\n${key}`, () => {
      const built = this.build(kind);
      built.card.classList.remove('still');
      built.fold.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(key);
      });
      built.card.addEventListener('click', () => this.toggle(key));
      return built;
    });
    const open = !this.folded.has(key);
    setFolded(row.fold, !open);
    row.fold.setAttribute('aria-expanded', String(open));
    row.fold.setAttribute('aria-label', open ? `Fold ${label}` : `Unfold ${label}`);
    row.card.style.setProperty('--depth', String(depth));
    return row;
  }

  private fileRow(rootPath: string, file: DiffFile, depth: number, flat: boolean): HTMLElement {
    const placed: Placed = { root: rootPath, path: file.path };
    const row = this.rows.draw(`file\n${foldKey(rootPath, file.path)}`, () => {
      const built = this.build('explorer-file');
      built.card.classList.remove('still');
      built.card.addEventListener('click', (event) => this.press(placed, event));
      return built;
    });
    this.shown.push(placed);
    const picked = this.drawn.picked?.root === rootPath && this.drawn.picked.path === file.path;
    row.card.classList.toggle('picked', picked);
    row.card.setAttribute('aria-current', String(picked));
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

/** A root's or folder's key among the folded ones: the root, then the path in it, empty for the root itself. */
const foldKey = (root: string, path: string): string => `${root}\n${path}`;

/** What a root's row says at its end: how many files changed there, or that git would not say. */
function rootTrail(read: ChangesRead | undefined): Node[] {
  if (!read) return [];
  if (read.kind === 'failed') return [span('explorer-root-failed', 'unreadable')];
  return [document.createTextNode(String(read.summary.files.length))];
}

/** The branch a root has out, after its name: the branch mark a worktree session's tab wears, then the branch, none where it is the folder's own name, as for a worktree made for one branch, or where there is none. */
function branchMark(read: ChangesRead | undefined, name: string): HTMLElement | null {
  const branch = read?.kind === 'summary' ? read.summary.branch : null;
  if (!branch || branch === name) return null;
  const mark = element('span', 'explorer-branch');
  mark.innerHTML = WORKTREE_ICON;
  mark.append(span('explorer-branch-name', branch));
  mark.title = branch;
  return mark;
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
  if (flat && cut >= 0) text.append(span('explorer-folder-part', path.slice(0, cut + 1)), path.slice(cut + 1));
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
