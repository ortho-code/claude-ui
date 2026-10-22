import type { SessionSummary } from '../../../../shared/types';
import { entityKey, modelLabel, relativeTime, sessionLabel, unstartableReason, worktreeMarkState } from '../../../logic';
import type { MenuItem } from '../../../menu';
import type { Moment } from '../../../moments';
import type { View } from '../../../state/app';
import { groupNameOf, projName } from '../../../state/views';
import { statusText } from '../../../statusdot';

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

/** When a session was archived, as its row in the archived view says it; null for a session that is not archived. */
export function archivedMoment(session: SessionSummary, view: View<'archived'>): Moment | null {
  const ts = view.archived.get(entityKey(session));
  if (ts === undefined) return null;
  if (!ts) return { text: 'archived', at: null };
  const at = new Date(ts).toISOString();
  return { text: `archived ${relativeTime(at)}`, at };
}

/** What a session's menu opens with: its title, then where it is filed and its status, when it was active and on what model, when it was archived, its worktree, its note's first line, and why it cannot run. */
export function sessionHeader(
  session: SessionSummary,
  view: View<'projectNames' | 'groupState' | 'statuses' | 'backgroundTasks' | 'acked' | 'tabs' | 'switchedModel' | 'notes' | 'archived'>,
): MenuItem {
  const where = [projName(session.repoRoot, view), groupNameOf(session, view), statusText(session.id, view)];
  const note = view.notes.get(entityKey(session))?.split('\n')[0];
  const lines = [where.filter(Boolean).join(' · '), activityMoment(session, view).text, archivedMoment(session, view)?.text, worktreeMarkState(session)?.tooltip, note, unstartableReason(session)];
  return { label: sessionLabel(session), header: lines.filter((line): line is string => Boolean(line)) };
}
