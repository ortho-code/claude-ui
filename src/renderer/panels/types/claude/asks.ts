import type { SessionSummary } from '../../../../shared/types';
import { promptText } from '../../../dialogs';
import { entityKey, sessionLabel, unstartableReason } from '../../../logic';
import { newSession, untitledLabel } from '../../../newsession';
import { store } from '../../../state/app';
import { moveSessionToGroup } from '../../../state/groups';
import { setProjectOnShow } from '../../../state/project';
import { projName, sessionById, tabWith } from '../../../state/views';
import { showToast } from '../../../toast';
import { hostOf } from '../builtin';
import type { Asks } from '../../contract';
import { activateTab, closeTab, createTab, startTab, stopSession, switchWorkspaceTerminal, type TabLaunch } from './terminals';

/**
 * The terminal area's answers to the asks every panel can make (`Asks`): open a session, start a new one, a worktree one or a fork, stop one, close its tabs, and follow the project chosen.
 * renderer.ts hands them to the tree with the sidebar's (sessions/asks.ts), and every panel's host carries them as they are.
 */

// Jump to a specific session from outside the list — the footer, a panel's row, an attention toast: scope to its project if needed, then open/focus its tab.
export function jumpToSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const { activeProject } = store.get();
  const host = hostOf('claude');
  if (activeProject !== null && activeProject !== session.repoRoot) host.selectProject(session.repoRoot);
  void openSession(session, launch);
  // Scope alone isn't enough to SEE it: the row can sit inside a collapsed group or project.
  // Reveal the same way clicking a tab does — jumping to a sibling filed in another group is exactly the case where scoping to the project still leaves the row hidden.
  host.revealSession(session.id);
}

/**
 * Open a session's tab, starting it when it is not running.
 * A first prompt is for a session that is NOT running, which starts with it — a resumed one included; one that is running is only brought into view, since typing into a live session is never the app's to do.
 */
async function openSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): Promise<void> {
  const existing = tabWith(session.id);
  if (existing) {
    if (existing.terminalId === null && launch.prompt) {
      activateTab(existing.token, false);
      await startTab(existing.token, launch);
      return;
    }
    activateTab(existing.token);
    return;
  }
  await createTab(session, launch);
}

// Land where a new tab will be visible: stay in its own project, else drop the scope to All.
// Only the scope: the new tab, which its caller creates next, is the one that comes on show.
function ensureProjectVisible(repoRoot: string): void {
  const { activeProject } = store.get();
  if (activeProject !== null && repoRoot !== activeProject) setProjectOnShow(null);
}

// Start a brand-new claude session in `cwd`, under an id this app mints; the sidebar row is that same session, filled in once claude writes its transcript.
// A panel's row starting one passes a name and a first prompt, and mints the id itself, so it can remember the session before the tab exists.
async function openNewSession(cwd: string, joinGroupId?: string, launch: Pick<TabLaunch, 'name' | 'prompt'> = {}, id: string = crypto.randomUUID()): Promise<void> {
  const session = newSession(id, { cwd, repoRoot: cwd, title: launch.name || untitledLabel(cwd) });
  // Filed BEFORE the tab exists, so the row's first paint is already inside the group. An ordinary membership write: the id is the session's real one, so there is nothing to correct afterwards.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: launch.name || undefined, prompt: launch.prompt || undefined });
}

/** Go to a session a panel's row started, as a jump from the attention strip does; one whose folder is gone says so, as its row in the list would. */
function openLinkedSession(id: string, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const session = sessionById(id);
  if (!session) return;
  const reason = unstartableReason(session);
  if (reason) {
    showToast(reason);
    return;
  }
  jumpToSession(session, launch);
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`.
// Prompts for an optional name (blank -> claude auto-names).
// Like openNewSession, the tab carries the session's real id from the start; the worktree badge is the only optimistic part, and it reconciles on the next refresh.
async function openWorktreeSession(repoRoot: string, joinGroupId?: string): Promise<void> {
  // claude's `-w` name must be a slug (letters/digits/dots/underscores/dashes); turn the free-text label into one. A blank slug means auto-name, which can't collide.
  const slugify = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const label = await promptText(
    'New worktree session',
    `Worktree of "${projName(repoRoot, store.get())}"`,
    '',
    'Create',
    // Validate in the dialog so a duplicate name is caught without closing it — claude -w would otherwise silently switch to the existing worktree instead of creating one.
    async (value) => {
      const s = slugify(value);
      return s && (await window.claudeUi.worktreeExists(repoRoot, s))
        ? `A worktree named "${s}" already exists in this project.`
        : null;
    },
  );
  if (label === null) return;
  const friendly = label.trim();
  // Pass the label as `--name` so the session still displays what was typed.
  const slug = slugify(friendly);
  const session = newSession(crypto.randomUUID(), {
    cwd: repoRoot,
    repoRoot,
    isRepo: true,
    // Show the worktree badge right away (optimistic); it reconciles to the real name on refresh.
    worktree: slug || 'new worktree',
    // The name you typed becomes the title (it's also what --name sets); the badge already says it's a worktree, so no prefix. Blank name falls back to a plain new-session label.
    title: friendly || untitledLabel(repoRoot),
  });
  // Same as openNewSession: filed before the tab exists, so the row never appears loose.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: friendly || undefined, worktree: slug });
}

// Fork an existing session: `claude --session-id <new> --resume <parent> --fork-session` copies its transcript into a new session in the same cwd.
// The fork's id is minted here like any other new session — claude honours it even while resuming — so the fork is a row of its own from the first paint, not one that arrives later.
async function forkSession(parent: SessionSummary): Promise<void> {
  const parentTitle = sessionLabel(parent, 'session');
  // Forks copy the parent's title, so offer a fresh name up front (via claude's --name). Cancel aborts the fork; keeping/clearing the field just inherits the parent title.
  const name = await promptText('Create fork', `Fork from "${parentTitle}"`, parentTitle, 'Fork');
  if (name === null) return;
  const trimmed = name.trim();
  const session = newSession(crypto.randomUUID(), {
    cwd: parent.cwd,
    repoRoot: parent.repoRoot,
    isRepo: parent.isRepo,
    worktree: parent.worktree,
    title: trimmed || parentTitle,
    // Mark it a family member right away (we know its parent is a sibling), so the row shows the sibling mark immediately instead of waiting for claude to write the transcript.
    // It reconciles to the real row once that file lands and grouping runs on the next refresh.
    isSibling: true,
    siblingIds: [parent.id],
  });
  ensureProjectVisible(session.repoRoot);
  // A fork continues its parent's work, so it belongs wherever the parent was filed — and it shows there immediately, like a new session started from the group's "+".
  const parentGroup = store.get().groupState.groupOf[entityKey(parent)];
  if (parentGroup) await moveSessionToGroup(session, parentGroup);
  await createTab(session, { resumeFrom: parent.id, fork: true, name: trimmed || undefined });
}

/** The asks the terminal area answers. */
export const claudeAnswers: Pick<Asks, 'openSession' | 'openTab' | 'openNewSession' | 'openWorktreeSession' | 'forkSession' | 'stopSession' | 'closeTabs' | 'showProject'> = {
  openSession: (id, prompt) => openLinkedSession(id, { prompt }),
  openTab: (id) => {
    const session = sessionById(id);
    if (session) void openSession(session);
  },
  openNewSession: (cwd, groupId, launch, id) => openNewSession(cwd, groupId, launch, id),
  openWorktreeSession: (repoRoot, groupId) => openWorktreeSession(repoRoot, groupId),
  forkSession: async (id) => {
    const session = sessionById(id);
    if (session) await forkSession(session);
  },
  stopSession: (id) => {
    const tab = tabWith(id);
    if (tab) stopSession(tab.token);
  },
  closeTabs: (id) => {
    for (const tab of store.get().tabs) if (entityKey(tab.session) === id) closeTab(tab.token);
  },
  showProject: (repoRoot) => switchWorkspaceTerminal(repoRoot),
};
