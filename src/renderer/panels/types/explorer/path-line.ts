import { element } from '../../../ui/dom';
import { wordButton } from '../../../ui/word-button';
import { openMenu } from '../../../ui/menu';
import './path-line.css';

/** Where the topmost row in view sits, as the path names it: its root, by the name its row has, and the folders that hold it. */
export interface Place {
  root: string;
  name: string;
  folders: readonly string[];
}

/**
 * THE PATH OVER THE EXPLORER'S LIST: where the topmost row in view sits, so a long tree keeps saying which checkout and folder you are in, as you scroll.
 * Its root's name, at most 40% of the line while folders follow it, then the folders that hold the row; when that is wider than the line, folders are taken out from the root's side into one `…`, the root's name and the nearest folder kept to the last, and then the root's name is cut further at its end, so the nearest folder stays whole where that frees enough room.
 * Each part is a press away from the row it names.
 * Out of sight while the top row is a root's own, which says as much already.
 */
export class PathLine {
  readonly el = element('div', 'explorer-path');
  /** What it last drew, at which width, so a scroll that stays within one folder draws nothing and a resize fits it again. */
  private drawn = '';

  /** `go` brings the row of `root`, or of the folder `folders` names in it, into view. */
  constructor(private readonly go: (root: string, folders: readonly string[]) => void) {
    this.el.hidden = true;
  }

  draw(place: Place | null): void {
    this.el.hidden = place === null;
    if (!place) {
      this.drawn = '';
      this.el.replaceChildren();
      return;
    }
    const drawn = `${this.el.clientWidth}\n${JSON.stringify(place)}`;
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    // Taken out one by one from the root's side until the line fits, the nearest folder never; the root's name keeps its width, at most its cap, meanwhile, and gives way further only once no folder is left to take out.
    this.el.classList.remove('cut');
    const most = Math.max(0, place.folders.length - 1);
    for (let out = 0; out <= most; out++) {
      this.el.replaceChildren(...this.parts(place, out));
      if (this.el.scrollWidth <= this.el.clientWidth) return;
    }
    this.el.classList.add('cut');
  }

  /** The root's part, `›`, then the folders between slashes, the first `out` of them as one `…` that lists them. */
  private parts(place: Place, out: number): HTMLElement[] {
    const root = this.part(place.name, place.root, []);
    root.classList.add('explorer-path-root');
    root.classList.toggle('capped', place.folders.length > 0);
    const parts = [root];
    place.folders.forEach((folder, at) => {
      if (at < out && at > 0) return;
      parts.push(separator(at === 0 ? '›' : '/'));
      parts.push(at < out ? this.folded(place, out) : this.part(folder, place.root, place.folders.slice(0, at + 1)));
    });
    return parts;
  }

  /** The `…` the first `out` folders are folded into: a press lists them, from the root down, each a press away from its row. */
  private folded(place: Place, out: number): HTMLElement {
    const more = wordButton('explorer-path-part explorer-path-more');
    more.textContent = '…';
    const hidden = place.folders.slice(0, out);
    more.title = hidden.join('/');
    more.addEventListener('click', () =>
      openMenu(
        more,
        hidden.map((folder, at) => ({ label: folder, onSelect: () => this.go(place.root, place.folders.slice(0, at + 1)) })),
      ),
    );
    return more;
  }

  private part(label: string, root: string, folders: readonly string[]): HTMLElement {
    const part = wordButton('explorer-path-part');
    part.textContent = label;
    part.title = folders.length ? folders.join('/') : root;
    part.addEventListener('click', () => this.go(root, folders));
    return part;
  }
}

function separator(text: string): HTMLElement {
  const mark = element('span', 'explorer-path-sep');
  mark.textContent = text;
  return mark;
}
