import { projectGoneReason } from './logic';
import { folderGoneIcon } from './svg';
import { setTooltip } from './tooltip';
import './projectgone.css';

/**
 * Mark a project whose folder is gone, the same way on every surface that names one — its heading, the switcher's entries and title, the tab bar's project label: the name muted, the crossed-out folder beside it, and why as the tooltip.
 * The heading already has a folder in front of its name, so its `mark` is that slot and `live` is what it holds while the folder is there; everywhere else the mark comes after the name and is empty then, so the names stay aligned.
 * `pathTip` is the element whose tooltip is the project's path while it is alive, and the reason once it is not.
 */
export function markProjectGone(repoRoot: string, gone: boolean, name: HTMLElement, mark: HTMLElement, size: number, pathTip?: HTMLElement, live = ''): void {
  const reason = gone ? projectGoneReason(repoRoot) : null;
  name.classList.toggle('project-gone', gone);
  mark.classList.toggle('project-gone', gone);
  mark.innerHTML = gone ? folderGoneIcon(size) : live;
  mark.hidden = !gone && !live;
  setTooltip(mark, reason);
  if (pathTip) setTooltip(pathTip, reason ?? repoRoot);
}
