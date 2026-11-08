import type { SessionSummary } from '../../../../shared/types';
import { entityKey, setAsideLabel, modelLabel, relativeTime, sessionLabel, unstartableReason, worktreeMarkState } from '../../../logic';
import type { HeaderLine, MenuItem } from '../../../menu';
import type { Moment } from '../../../moments';
import type { View } from '../../../state/app';
import { groupNameOf, projName } from '../../../state/views';
import { statusLines } from '../../../statusdot';

/**
 * WHAT IS SAID ABOUT A SESSION, in words: its menu's header, and its row's title and its meta line, which draw from here, so the row and the header cannot come to say those differently.
 */

/** The model to show for a session: the one it has switched to if we saw that happen, else the one that last answered. */
function modelOf(session: SessionSummary, view: View<'switchedModel'>): string {
  return view.switchedModel.get(session.id) ?? session.model;
}

/** When a session was last active, and the model it runs, as its row's meta line says them. */
export function activityMoment(session: SessionSummary, view: View<'switchedModel'>): Moment {
  const model = modelLabel(modelOf(session, view));
  const when = relativeTime(session.lastActivity);
  return { text: model ? `${when} · ${model}` : when, at: session.lastActivity };
}

/** When a session was finished, as its row in the finished view says it; null for a session that is not finished. */
export function finishedMoment(session: SessionSummary, view: View<'finished'>): Moment | null {
  const ts = view.finished.get(entityKey(session));
  if (ts === undefined) return null;
  if (!ts) return { text: 'finished', at: null };
  const at = new Date(ts).toISOString();
  return { text: `finished ${relativeTime(at)}`, at };
}

/** Where a row drawn flat sits, where no heading says it: its project in All, and its group, ahead of the rest of its line; null where the scope says it all. */
export function whereOf(session: SessionSummary, view: View<'activeProject' | 'projectNames' | 'groupState'>): string | null {
  const group = groupNameOf(session, view);
  const parts = [...(view.activeProject === null ? [projName(session.repoRoot, view)] : []), ...(group ? [group] : [])];
  return parts.length > 0 ? parts.join(' › ') : null;
}

/**
 * What a session's menu opens with: its title, then where it is filed, each state it is in on a line of its own with its dot, its set-aside mark, when it was active and on what model, when it was finished, its worktree, its note's first line, and why it cannot run.
 * Every state, where its one dot shows the strongest: a session ready and needing you says both (decided 2026-10-28).
 */
export function sessionHeader(
  session: SessionSummary,
  view: View<'projectNames' | 'groupState' | 'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'switchedModel' | 'notes' | 'finished' | 'settings' | 'needsYouTypes'>,
): MenuItem {
  const where = [projName(session.repoRoot, view), groupNameOf(session, view)].filter(Boolean).join(' · ');
  const note = view.notes.get(entityKey(session))?.split('\n')[0];
  const setAside = view.setAside.get(entityKey(session));
  const after = [setAside && setAsideLabel(setAside), activityMoment(session, view).text, finishedMoment(session, view)?.text, worktreeMarkState(session)?.tooltip, note, unstartableReason(session)];
  const lines: HeaderLine[] = [...(where ? [where] : []), ...statusLines(session.id, view), ...after.filter((line): line is string => Boolean(line))];
  return { label: sessionLabel(session), header: lines };
}
