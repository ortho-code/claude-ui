import type { SessionPr, SessionSummary } from '../../../../shared/types';
import { prKey, prName, spansRepositories } from '../../../../shared/sessions/prs';
import { entityKey, LAST_ACTIVE, modelLabel, sessionLabel, unstartableReason, worktreeMarkState } from '../../../rules/sessions';
import { setAsideLabel } from '../../../status/state-lines';
import { prDetails, prRulesIn } from '../../../status/pr-status';
import { relativeTime } from '../../../ui/time-words';
import { momentInLanguage } from '../../../ui/locale';
import type { HeaderLine, MenuItem } from '../../../ui/menu';
import { momentLine, type Moment } from '../../../ui/moments';
import type { View } from '../../../state/app';
import { groupNameOf, projName } from '../../../state/views';
import { statusLines, type LinesView } from '../../../status/status-dot';

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
  return { text: model ? `${when} · ${model}` : when, at: session.lastActivity, label: LAST_ACTIVE };
}

/** When a session was finished, as its row in the finished view says it; null for a session that is not finished. */
export function finishedMoment(session: SessionSummary, view: View<'finished'>): Moment | null {
  const ts = view.finished.get(entityKey(session));
  if (ts === undefined) return null;
  if (!ts) return { text: 'finished', at: null, label: 'Finished' };
  const at = new Date(ts).toISOString();
  return { text: `finished ${relativeTime(at)}`, at, label: 'Finished' };
}

/** Where a row drawn flat sits, where no heading says it: its project in All, and its group, ahead of the rest of its line; null where the scope says it all. */
export function whereOf(session: SessionSummary, view: View<'activeProject' | 'projectNames' | 'groupState'>): string | null {
  const group = groupNameOf(session, view);
  const parts = [...(view.activeProject === null ? [projName(session.repoRoot, view)] : []), ...(group ? [group] : [])];
  return parts.length > 0 ? parts.join(' › ') : null;
}

/**
 * Each PR a session links as its list names it, oldest first: its number and title (`prName`), and what GitHub last said of it on a line under it (`prDetails`), led by its repository where the session's PRs are all in one.
 * The PR menus and the row's tooltip say them alike.
 */
export function prItemWords(session: SessionSummary, view: View<'prStatus' | 'prNames' | 'settings' | 'needsYouTypes'>): { pr: SessionPr; label: string; details: string[] }[] {
  const rules = prRulesIn(view);
  const withRepository = spansRepositories(session.prs);
  return session.prs.map((pr) => ({
    pr,
    label: prName(pr, view.prNames.get(prKey(pr))?.title, withRepository),
    details: [...(withRepository ? [] : [pr.repository]), ...prDetails(pr, view.prStatus, rules, momentInLanguage)],
  }));
}

/**
 * What a session row's tooltip says, everything the row shows: its name, why it cannot start, its line in full, each state it is in as its dot says them, its set-aside mark and its worktree, its moment and when it was last active where that is another, each PR with its date, and its whole note.
 * `line` is the row's line as drawn, `moment` the one it gives (`Moment`).
 */
export function rowTooltip(session: SessionSummary, view: RowTooltipView, line: string, moment: Moment): string {
  const setAside = view.setAside.get(entityKey(session));
  const note = view.notes.get(entityKey(session));
  const lines = [
    sessionLabel(session),
    unstartableReason(session),
    line,
    ...statusLines(session.id, view).map(({ text }) => text),
    setAside && setAsideLabel(setAside),
    worktreeMarkState(session)?.tooltip,
    moment.at && momentLine(moment.label, moment.at),
    moment.label !== LAST_ACTIVE && momentLine(LAST_ACTIVE, session.lastActivity),
    ...prItemWords(session, view).map(({ label, details }) => (details.length > 0 ? `${label} — ${details.join(' · ')}` : label)),
    note && `Note: ${note}`,
  ];
  return lines.filter((part): part is string => typeof part === 'string' && part !== '').join('\n');
}

/** What a row's tooltip reads from the store. */
export type RowTooltipView = LinesView & View<'notes' | 'prStatus' | 'prNames'>;

/**
 * What a session's menu opens with: its title, then where it is filed, each state it is in on a line of its own with its dot, its set-aside mark, when it was active and on what model, when it was finished, its worktree, its note's first line, and why it cannot run.
 * Every state, where its one dot shows the strongest: a session ready and needing you says both (decided 2026-10-28).
 */
export function sessionHeader(
  session: SessionSummary,
  view: View<'projectNames' | 'groupState' | 'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'switchedModel' | 'notes' | 'finished' | 'settings' | 'needsYouTypes' | 'prNames'>,
): MenuItem {
  const where = [projName(session.repoRoot, view), groupNameOf(session, view)].filter(Boolean).join(' · ');
  const note = view.notes.get(entityKey(session))?.split('\n')[0];
  const setAside = view.setAside.get(entityKey(session));
  const after = [setAside && setAsideLabel(setAside), activityMoment(session, view).text, finishedMoment(session, view)?.text, worktreeMarkState(session)?.tooltip, note, unstartableReason(session)];
  const lines: HeaderLine[] = [...(where ? [where] : []), ...statusLines(session.id, view), ...after.filter((line): line is string => Boolean(line))];
  return { label: sessionLabel(session), header: lines };
}
