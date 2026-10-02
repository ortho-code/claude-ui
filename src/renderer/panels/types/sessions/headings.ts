// Its headings are the section heading a list panel draws too.
import { sectionHeading } from '../../../card';
import { openMenu, type MenuItem } from '../../../menu';
import { store } from '../../../state/app';
import { folderIcon, layersIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { copyText, deleteGroupById, groupMoveItems, projectMoveItems, promptNewGroup, renameGroupById, renameProject, withMoves } from './actions';
import { kebabButton, newSessionSplit } from './controls';
import { container, jumpTargets, type GroupSectionEls, type ProjectSectionEls } from './drawn';
import { toggleFold } from './folding';
import { revealGroup } from './reveal';
import './headings.css';

/**
 * THE SESSION LIST'S SECTIONS, each built once with its heading's controls: a project's, with its jump menu, its new-session split button and its options, and a group's, with its own split button and options over the well that holds its rows.
 * What they show — names, counts, folds, the rows — the draw writes into them on every render (list.ts).
 */

// Build a project section once; its contents (name, count, caret, rows) are drawn by reconcileProjectSections, on this render and every later one.
export function createProjectSection(name: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const { heading, caret, icon, label, count } = sectionHeading('project', folderIcon(14));
  setTooltip(label, name); // full path on hover
  // Jump straight to one of this project's groups instead of scrolling for it.
  // The heading is position:sticky, so this trigger is on screen the whole time you scroll the project — which is what makes a menu enough here, rather than a panel that would cost a line of height per project.
  // reconcileProjectSections hides it below 2 targets and disables it while filtering.
  const groupsBtn = document.createElement('button');
  groupsBtn.className = 'icon-btn project-groups';
  groupsBtn.innerHTML = layersIcon(14);
  groupsBtn.hidden = true;
  setTooltip(groupsBtn, 'Jump to a group');
  groupsBtn.addEventListener('click', (event) => {
    event.stopPropagation(); // don't collapse the project
    const targets = jumpTargets.get(name) ?? [];
    const items: MenuItem[] = [];
    for (const t of targets) {
      // A rule before the ungrouped entry: it is a different KIND of target, not another group.
      if (t.groupId === null && items.length > 0) items.push({ label: '', separator: true });
      items.push({
        label: t.name,
        count: t.count,
        badge: t.badge,
        muted: t.groupId === null,
        onSelect: () => revealGroup(name, t.groupId),
      });
    }
    openMenu(groupsBtn, items);
  });
  heading.append(groupsBtn);
  const { split, add, addCaret } = newSessionSplit({
    addClass: 'project-add',
    caretClass: 'project-add-caret',
    plusSize: 12,
    tooltip: 'New session in this project',
    where: () => ({ repoRoot: name }),
  });
  heading.append(split);
  // Project options (rename now, hide later).
  const kebab = kebabButton('project-kebab pair-end', 'Project options', () =>
    withMoves(projectMoveItems(name), [
      { label: 'Rename…', onSelect: () => void renameProject(name) },
      { label: 'Copy path', onSelect: () => void copyText(name, 'Path copied.') },
      { label: '', separator: true },
      { label: 'New group…', onSelect: () => void promptNewGroup(name) },
    ]),
  );
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker.
  // Keep the clicked heading anchored: a sticky heading otherwise snaps between stuck and natural position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    // Not collapsible in a single-project view: hiding the one project you're looking at leaves an empty sidebar. The heading is a title there, and applyFolds drops its caret to say so.
    if (store.get().activeProject !== null) return;
    const before = heading.getBoundingClientRect().top;
    toggleFold('projects', name);
    container.scrollTop += heading.getBoundingClientRect().top - before;
  });
  section.appendChild(heading);

  return { section, heading, caret, count, icon, label, groupsBtn, addCaret, addBtn: add };
}

// Build a group's sub-section once: a heading (lighter than the project's — no divider, not sticky) over an indented well that holds its rows. Contents are updated on later renders.
export function createGroupSection(id: string): GroupSectionEls {
  const section = document.createElement('section');
  section.className = 'group';

  const { heading, caret, label, count } = sectionHeading('bar', layersIcon(13));
  // Start a session already in this group, from a split button like the project heading's.
  const { split, add, addCaret } = newSessionSplit({
    addClass: 'group-add',
    caretClass: 'group-add-caret',
    plusSize: 14,
    tooltip: 'New session in this group',
    where: () => {
      const repoRoot = store.get().groupState.groups.find((g) => g.id === id)?.repoRoot;
      return repoRoot ? { repoRoot, groupId: id } : null;
    },
  });
  // Group options.
  const kebab = kebabButton('group-kebab pair-end', 'Group options', () =>
    withMoves(groupMoveItems(id), [
      { label: 'Rename…', onSelect: () => void renameGroupById(id) },
      { label: 'Delete group', onSelect: () => void deleteGroupById(id) },
    ]),
  );
  heading.append(split, kebab);
  heading.addEventListener('click', () => {
    toggleFold('groups', id);
  });

  // The rows live in their own element so the indent and its rail wrap the whole group, which is what shows where a group ends without needing to read the next heading.
  const members = document.createElement('div');
  members.className = 'group-members';
  const empty = document.createElement('div');
  empty.className = 'section-empty'; // its text depends on the project's folder, so reconcileProjectSections writes it
  members.append(empty);

  section.append(heading, members);
  return { section, heading, caret, label, count, addCaret, addBtn: add, members, empty };
}
