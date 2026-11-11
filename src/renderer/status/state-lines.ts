import { referenceKey } from '../../shared/sessions/prs';
import { isPrReason, PR_TYPES } from '../../shared/status/needs-you';
import type { ClosedHow, NeedsYou, PrNeedsYouType, SetAside } from '../../shared/types';
import { momentLabel } from '../ui/time-words';
import { isNeeds, needsShown, rankedReasons, rankOf, shownState, showsRead, type Strength } from './shown';

/**
 * What each status is CALLED.
 * States, phrased as states: a dot answers "what is this session doing", not "what just happened to it".
 * `closed` is "Not running" rather than "Stopped" for that reason — it arrives from SessionEnd, which fires whether you stopped the session, claude finished, or the tab closed, so naming the event would be wrong in two of those three cases.
 */
const STATUS_LABEL: Record<string, string> = {
  busy: 'Busy',
  ready: 'Ready',
  // The turn has ended and claude's prompt is open, but work it started still runs.
  background: 'Working in the background',
  waiting: 'Waiting for you',
  closed: 'Not running',
  // Not a status a hook reports: what the dot of a session whose claude was asked to leave and has not shows in place of its last one (`dotStatus`).
  stopping: 'Stopping — waiting for claude to leave',
};

/** How the app closed, as the line of a session that was running then says it. */
const WAS_RUNNING: Record<ClosedHow, string> = {
  quit: 'Needs you — was running when the app quit',
  ended: 'Needs you — was running when the app ended without quitting',
  unknown: 'Needs you — was running when the app last closed',
};

/** One line of what a session's dot can show: what it says, and the state it says it of, a status or a reason (`NeedsShown`, a PR's line by its strongest), for the dot drawn beside it. */
export interface StateLine {
  text: string;
  state: string;
}

/**
 * A session's reasons as they are listed, in its dot's tooltip and its menu's header alike, each where the strength order puts its category, and within one newest first (decided 2026-11-06, in place of a rank of their own).
 * A PR is named by its number, "PR #35777 merged", and with its repository, "PR acme/app#35777 merged", only where the reasons name PRs in more than one; the changes one answer found, a reason each at the same moment, are named together on one line, in the same order, "PR #7 checks failed, approved", and the line goes where its first does.
 */
export function needsYouLines(reasons: readonly NeedsYou[], strength: Strength): StateLine[] {
  const prs = new Set(reasons.filter(isPrReason).map((reason) => referenceKey(reason.pr)));
  const repositories = new Set([...prs].map((pr) => pr.slice(0, pr.lastIndexOf('#'))));
  const answers = new Map<string, { pr: string; types: PrNeedsYouType[] }>();
  const lines: { key: string; reason: NeedsYou }[] = [];
  for (const reason of rankedReasons(reasons, strength)) {
    if (!isPrReason(reason)) {
      lines.push({ key: '', reason });
      continue;
    }
    const key = `${referenceKey(reason.pr)}\n${reason.at}`;
    const answer = answers.get(key);
    if (answer) answer.types.push(reason.type);
    else {
      answers.set(key, { pr: reason.pr, types: [reason.type] });
      lines.push({ key, reason });
    }
  }
  return lines.map(({ key, reason }) => {
    const state = needsShown(reason.type);
    const answer = answers.get(key);
    if (answer) return { text: `Needs you — PR ${repositories.size > 1 ? answer.pr : answer.pr.slice(answer.pr.lastIndexOf('#'))} ${answer.types.map((type) => PR_TYPES[type]).join(', ')}`, state };
    if (reason.type === 'app.was-running') return { text: WAS_RUNNING[reason.how], state };
    if (reason.type === 'app.reminder') return { text: `Needs you — reminder for ${momentLabel(reason.at)}`, state };
    return { text: `Needs you — ${reason.type}`, state };
  });
}

/** What a session's dot can show, all of it: what its tab says, its status as its hooks last reported it, what still runs behind its turn, and its needs-you reasons, with whether it is read. */
export interface DotStates {
  /** What its tab says in its dot (`tabDot`), such as stopping, which leads, since it describes a claude that has gone or is going. */
  tab: string | undefined;
  status: string | undefined;
  background: readonly string[];
  reasons: readonly NeedsYou[];
  /** Marked read. */
  acked: boolean;
  /** Its reasons muted by its set-aside mark (`mutedBySetAside`), which read as read. */
  muted: boolean;
}

/**
 * Every state a session is in, a line each, in its dot's tooltip and its menu's header alike: what its tab says, then its status and its reasons in the strength order, the first being what the dot shows where the tab says nothing (decided 2026-11-06, where the tooltip had said what the dot showed alone).
 * The read mark marks what the dot shows read, all its reasons where it shows one, and a muted reason is read wherever it is.
 * A status the order does not know goes after the rest and says itself, so a state nobody named still reads (`statusLabel`).
 */
export function stateLines(states: DotStates, strength: Strength): (StateLine & { read: boolean })[] {
  const shown = states.tab ?? shownState(states.status, states.reasons, strength);
  const reasons = needsYouLines(states.reasons, strength);
  const status = states.status === undefined ? [] : [{ text: statusLabel(states.status, states.background), state: states.status }];
  const ranked = [...status, ...reasons].sort((a, b) => rankOf(a.state, strength) - rankOf(b.state, strength));
  const lines = [...(states.tab === undefined ? [] : [{ text: statusLabel(states.tab, []), state: states.tab }]), ...ranked];
  return lines.map((line) => {
    const isShown = line.state === shown || (isNeeds(line.state) && isNeeds(shown));
    const read = (isShown && showsRead(line.state, states.acked)) || (isNeeds(line.state) && states.muted);
    return read ? { ...line, text: `${line.text} (read)`, read } : { ...line, read };
  });
}

/** Until when a set-aside mark holds, in the words that follow "Set aside": ", whenever", or " until Mon 3 Nov, 09:00" for one with a day. */
export function setAsideUntil(due: number | null): string {
  return due === null ? ', whenever' : ` until ${momentLabel(due)}`;
}

/** What a session's set-aside mark says, on its tooltip and in its menu's header: "Set aside, whenever", or "Set aside until Mon 3 Nov, 09:00" for one with a day. */
export function setAsideLabel(setAside: SetAside): string {
  return `Set aside${setAsideUntil(setAside.due)}`;
}

/**
 * A status as a line of a dot's tooltip.
 * Here rather than beside the dot it decorates, because the wording is the thing worth pinning — an unknown status used to render its own internal value at the user.
 *
 * It still falls back to the raw value, deliberately: a state this table has not been taught reads oddly rather than vanishing, which is the signal to name it.
 * That only works while everything reaching here is MEANT to be a state — the identity marker `start` is not, and is filtered out where it is read rather than hidden here.
 *
 * `background` also says what still runs, from the type claude gives each piece of work (`background`), counted per type: "2 shells, 1 subagent".
 */
export function statusLabel(status: string, background: readonly string[] = []): string {
  if (status === 'background' && background.length > 0) return `${STATUS_LABEL.background}: ${countedTypes(background)}`;
  return STATUS_LABEL[status] ?? status;
}

/** "2 shells, 1 subagent": each type once, in the order it first appears, with how many there are. */
function countedTypes(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
  return [...counts].map(([type, n]) => `${n} ${type}${n === 1 ? '' : 's'}`).join(', ');
}
