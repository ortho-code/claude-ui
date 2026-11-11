import { sessionById } from '../../../state/views';
import { hostOf } from '../builtin';
import type { Asks } from '../../contract';
import { editNote, sessionMenuItems, setAsideNamed, showInList } from './actions';
import { revealGroup, revealProject, revealSession } from './reveal';
import { selectProject } from './switcher';

/**
 * The sidebar's answers to the asks every panel can make (`Asks`): select a project, follow a session to its row, show a session in the list, bring a project's heading or a group's into view, a session's menu, Set aside… for sessions, as the bar asks it, and a session's note to edit.
 * renderer.ts hands them to the tree with the terminal area's (claude/asks.ts), and every panel's host carries them as they are.
 */
export const sessionsAnswers: Pick<Asks, 'selectProject' | 'followSession' | 'showInList' | 'revealProject' | 'revealGroup' | 'sessionMenu' | 'setAside' | 'editNote'> = {
  selectProject: (repoRoot) => selectProject(repoRoot),
  setAside: (ids) => setAsideNamed(ids),
  sessionMenu: (id, from, own) => {
    const session = sessionById(id);
    return session ? sessionMenuItems(session, from, own) : null;
  },
  editNote: (id) => {
    const session = sessionById(id);
    if (session) void editNote(session);
  },
  followSession: (id) => {
    const session = sessionById(id);
    if (session) revealSession(session);
  },
  showInList: (id) => {
    const session = sessionById(id);
    if (session) showInList(session);
  },
  revealProject: (repoRoot) => {
    hostOf('sessions').bringIntoView();
    revealProject(repoRoot);
  },
  revealGroup: (repoRoot, groupId) => {
    hostOf('sessions').bringIntoView();
    revealGroup(repoRoot, groupId);
  },
};
