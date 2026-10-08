import { sessionById } from '../../../state/views';
import type { Asks } from '../../contract';
import { sessionMenuItems } from './actions';
import { revealGroup, revealProject, revealSession } from './reveal';
import { selectProject } from './switcher';

/**
 * The sidebar's answers to the asks every panel can make (`Asks`): select a project, bring a session's row, a project's heading or a group's into view, and a session's menu.
 * renderer.ts hands them to the tree with the terminal area's (claude/asks.ts), and every panel's host carries them as they are.
 */
export const sessionsAnswers: Pick<Asks, 'selectProject' | 'revealSession' | 'revealProject' | 'revealGroup' | 'sessionMenu'> = {
  selectProject: (repoRoot) => selectProject(repoRoot),
  sessionMenu: (id) => {
    const session = sessionById(id);
    return session ? sessionMenuItems(session) : null;
  },
  revealSession: (id) => {
    const session = sessionById(id);
    if (session) revealSession(session);
  },
  revealProject: (repoRoot) => revealProject(repoRoot),
  revealGroup: (repoRoot, groupId) => revealGroup(repoRoot, groupId),
};
