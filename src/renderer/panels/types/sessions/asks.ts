import { sessionById } from '../../../state/views';
import type { Asks } from '../../contract';
import { jumpToGroup, revealProjectInSidebar, revealSessionInSidebar } from './reveal';
import { selectProject } from './switcher';

/**
 * The sidebar's answers to the asks every panel can make (`Asks`): select a project, and bring a session's row, a project's heading or a group's into view.
 * renderer.ts hands them to the tree with the terminal area's (claude/asks.ts), and every panel's host carries them as they are.
 */
export const sessionsAnswers: Pick<Asks, 'selectProject' | 'revealSession' | 'revealProject' | 'revealGroup'> = {
  selectProject: (repoRoot) => selectProject(repoRoot),
  revealSession: (id) => {
    const session = sessionById(id);
    if (session) revealSessionInSidebar(session);
  },
  revealProject: (repoRoot) => revealProjectInSidebar(repoRoot),
  revealGroup: (repoRoot, groupId) => jumpToGroup(repoRoot, groupId),
};
