import type { SessionSummary } from '../../../../shared/types';
import { modelLabel, relativeTime, sessionLabel } from '../../../logic';
import type { View } from '../../../state/app';

/**
 * WHAT IS SAID ABOUT A SESSION, in words: its row's title, and its meta line outside the archived view.
 */

/** The model to show for a session: the one it has switched to if we saw that happen, else the one that last answered. */
function modelOf(session: SessionSummary, view: View<'switchedModel'>): string {
  return view.switchedModel.get(session.id) ?? session.model;
}

/** When a session was last active, and the model it runs, as its row's meta line says them. */
export function activityLine(session: SessionSummary, view: View<'switchedModel'>): string {
  const model = modelLabel(modelOf(session, view));
  const when = relativeTime(session.lastActivity);
  return model ? `${when} · ${model}` : when;
}

/** A session's title, as its row shows it. */
export function sessionTitle(session: SessionSummary): string {
  return sessionLabel(session, '(no prompt yet)');
}
