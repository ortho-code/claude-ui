import type { SessionSummary } from '../../../../shared/types';
import { entityKey, sessionLabel } from '../../../rules/sessions';
import { newSession } from '../../../dialogs/newsession';
import { store, type TabState } from '../../../state/app';
import { moveSessionToGroupById } from '../../../state/groups';
import { clearNeedsYou } from '../../../state/needsyou';
import { setScheduled } from '../../../state/statuses';
import { sessionById } from '../../../state/views';
import { showToast } from '../../../ui/toast';
import { persistOpenTabs } from './opentabs';
import { setTab, tabOf } from './tabstate';
import { forceOutAtOnce, removeTab, stopCalledOff } from './terminals';

/**
 * A claude's start or a status event named the session a tab now runs: when that is another session than the tab's, the tab takes it over.
 * `source` is why, as claude's SessionStart says: only `clear` makes it a new session, and '' (a status event, which does not say) is taken as an existing one, since a clear's part done to one would move it out of its group.
 * Answers the tab already running that session when the take-over was undone for it (`adoptResumed`), for the caller to bring on show; else null.
 */
export function adoptReplacement(tabToken: string, id: string, source: string): TabState | null {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`, and claude's own `/resume` goes on in another session that already exists, under that session's id.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tabOf(tabToken);
  if (!owner || owner.session.id === id) return null;
  // A claude forced out asks nothing more of the tab while it goes, a report still on its way included: the tab keeps the session it ran, whatever that claude went on in.
  if (owner.forced) return null;
  if (source !== 'clear') return adoptResumed(owner, id);
  const previous = owner.session;
  const replaced = previous.id;
  // A CLEARED SESSION IS A NEW SESSION, so it starts from the same blank the "+" button does rather than from its predecessor's row.
  // Carrying the old object forward was the app's own half of the copied-title problem: it kept the title, the first message and the sibling marks of a conversation this session does not have.
  // The folder is all that genuinely survives — it is the same terminal, in the same place.
  // Everything that draws the tab follows: the bar names the new session, its stand-in row is the open one, and the history on show follows it, since a cleared session has a transcript of its own.
  // A clear while claude was asked to leave is going on working, as a prompt is: the leave is off.
  stopCalledOff(owner.token);
  // What the tab kept from its claude's last stop was the cleared session's, so it goes with it.
  setTab(owner.token, { session: blankAfter(previous, id), scheduledWhenStopped: null });
  // No claude of the app's runs the cleared session now, so what it had scheduled is not shown for it, though nothing will say its list emptied.
  setScheduled(replaced, []);
  // Nor does a tab hold it, which settles what it needed you for, as a close does; the new session needs nothing yet.
  clearNeedsYou(entityKey(previous), 'moved');
  // The stand-in is a blank; the TITLE on disk is Claude's, and is left alone.
  // Claude Code copies the cleared session's name into the new transcript, and a title from Claude is a session's name before anything else — so a named session goes on showing that name, exactly as `claude --resume` lists it.
  // Overriding it would mean this app and the CLI disagreeing about what a session is called.
  // The pairing is recorded because nothing else can observe it: neither transcript points at the other, and the connection exists only in this moment.
  void window.claudeUi.recordClear(replaced, id, previous.title);
  persistOpenTabs();
  // A group says where this WORK lives, and clearing a session does not move the work — so the replacement joins the group its predecessor was in, rather than the tab visibly dropping out of its section.
  // The predecessor keeps its own membership: it is still a real session, and still that group's history.
  // Only the group carries over.
  // A pin and a note are about one CONVERSATION, and that conversation still has its own row to hold them.
  const group = store.get().groupState.groupOf[replaced];
  if (group) void moveSessionToGroupById(id, group);
  return null;
}

/**
 * A tab whose claude went on in a session that already exists, by its own `/resume`: the tab takes it as it is, its row, title, group and pin, with nothing carried from the session before.
 * Finishing is this app's and claude cannot see it, so the session can be a finished one: it is made unfinished, since the app runs no finished session, and a toast says so, since nobody pressed Unfinished.
 * Another tab can hold the session too: one with no claude behind it goes, since this tab is the session's now; one running it is left alone and the take-over undone, this tab's claude forced out and the tab kept on the session it ran before, and that tab is answered.
 */
function adoptResumed(owner: TabState, id: string): TabState | null {
  // claude lets a second claude resume a session another runs, and the two then branch its transcript, each turn hanging off the same message, so a later resume drops one of them (measured on claude 2.1.302).
  // No hook can refuse a `/resume` (SessionStart cannot block, and neither UserPromptSubmit nor UserPromptExpansion fires for it, measured), so this is the closest to refusing it: the claude that switched is forced out as soon as the app hears of it, before any turn of its own unless one was submitted first.
  const other = store.get().tabs.find((t) => t.token !== owner.token && t.session.id === id);
  if (other && (other.terminalId !== null || other.starting)) {
    // Forced, not asked: in the app such a claude was seen to ignore the Ctrl-C an ask sends (three times out of three, 2026-10-20, cause unknown), and the two of those forced went within a second; it has nothing of its own to finish.
    // Once: a report from it while it goes asks nothing more (`forced`, above).
    // A claude you had asked to leave went on working too, so that leave is off, and it is forced all the same, since it is a second claude in the session either way.
    stopCalledOff(owner.token);
    forceOutAtOnce(owner.token);
    return other;
  }
  // Its row where another tab or the listing has it; else the blank, until the listing reads it (`reconcileOpenTabs`).
  const session = sessionById(id) ?? blankAfter(owner.session, id);
  // A resume while claude was asked to leave is going on working, as after a clear.
  stopCalledOff(owner.token);
  // What the tab kept from its claude's last stop was the session it left, as after a clear.
  setTab(owner.token, { session, scheduledWhenStopped: null });
  // The session it left runs in no claude of the app's now, as after a clear, and no tab holds it, which settles what it needed you for.
  setScheduled(owner.session.id, []);
  clearNeedsYou(entityKey(owner.session), 'moved');
  // After the take-over, so the session's status, which is this tab's now, stays (`removeTab`).
  if (other) removeTab(other.token);
  persistOpenTabs();
  const key = entityKey(session);
  if (!store.get().finished.has(key)) return null;
  void window.claudeUi.unfinish([key], 'resume').then((finished) => {
    store.set({ finished: new Map(Object.entries(finished)) });
    showToast(`"${sessionLabel(session)}" was finished; resuming it in claude made it unfinished`);
  }, () => showToast(`"${sessionLabel(session)}" is finished and running; make it unfinished from the finished sessions`));
  return null;
}

/** The "+" button's blank for session `id`, in the folder of the session a tab ran before it: the same terminal, in the same place. */
function blankAfter(previous: SessionSummary, id: string): SessionSummary {
  return newSession(id, { cwd: previous.cwd, repoRoot: previous.repoRoot, isRepo: previous.isRepo, worktree: previous.worktree });
}
