import type { NeedsYou, SessionSummary } from '../../shared/types';
import { entityKey } from '../rules/sessions';
import { isNeeds, rankOf, shownState, type NeedsShown, type Strength } from './shown';

// A project's rolled-up nudge for the switcher: the strongest UNATTENDED state among its sessions, so a project you're not looking at still shows it needs you.
// What asks for you (waiting, a needs-you reason, ready) over what works, each in the strength order; null when nothing needs surfacing.
// A read session waiting, needing you or finished is muted and contributes nothing (`nudgeOf`).
export type NudgeStatus = 'waiting' | NeedsShown | 'ready' | 'busy' | null;

/**
 * One session's part in a roll-up: what it shows (`shownState`), muted to nothing once read, and a reason also once its set-aside mark mutes it (`muted`); closed, unknown or not reported yet is nothing too.
 * Only waiting, a reason and ready can be read (`toggleAck`), and a new status clears the mark, so the mark mutes only those.
 * Work still running after the turn ended (`background`) is working, so it rolls up as busy: a roll-up must not carry a "ready" that is not true yet.
 */
export function nudgeOf(shown: string | undefined, acked: boolean, muted = false): NudgeStatus {
  if (shown === 'waiting' || shown === 'ready') return acked ? null : shown;
  if (isNeeds(shown)) return acked || muted ? null : shown;
  return shown === 'busy' || shown === 'background' ? 'busy' : null;
}

/**
 * The nudge that speaks for several, and nothing when none has one; how sessions roll up into a project and projects into a line.
 * What asks for you comes before what works, each in the strength order, whatever the order says of the two (decided 2026-11-06): a roll-up says where you are needed, and a session at work there needs nothing yet, while a dot says what one session is doing.
 * With the default order: waiting, then each category in Now's order, then ready, then busy.
 */
export function strongestNudge(nudges: Iterable<NudgeStatus>, strength: Strength): NudgeStatus {
  let strongest: NudgeStatus = null;
  for (const nudge of nudges) {
    if (nudge === null) continue;
    if (strongest === null || (asksForYou(nudge) && (!asksForYou(strongest) || rankOf(nudge, strength) < rankOf(strongest, strength)))) strongest = nudge;
  }
  return strongest;
}

/** Whether a nudge asks something of you: waiting for you, marked as needing you, or a turn that finished, and not marked read, which `nudgeOf` has already taken away; work in progress asks nothing. */
export function asksForYou(nudge: NudgeStatus): boolean {
  return nudge === 'waiting' || nudge === 'ready' || isNeeds(nudge);
}

/**
 * A session's part in a roll-up, by the rule its dot follows: what it shows (`shownState`), muted to nothing once read, and a needs-you mark its set-aside mark mutes (`mutedBySetAside`) is read wherever the dot shows it, so it rolls up as nothing too (decided 2026-10-29).
 * Claude's status shows over a muted mark (`mutedGivesWay`), and so still counts.
 */
export function sessionPart(status: string | undefined, reasons: readonly NeedsYou[], muted: boolean, acked: boolean, strength: Strength): NudgeStatus {
  return nudgeOf(shownState(status, reasons, strength, muted), acked, muted);
}

/** What several sessions add up to: how many ask for you, how many are at work, and the nudge that speaks for them (`strongestNudge`). */
export interface RollUp {
  /** The sessions whose part asks for you (`asksForYou`). */
  asking: number;
  /** The sessions whose part is at work, background work included. */
  working: number;
  badge: NudgeStatus;
}

/** What a session's part was last worked out from, and the part: answered again while nothing it was worked out from has moved. */
interface KeptPart {
  status: string | undefined;
  reasons: readonly NeedsYou[] | undefined;
  muted: boolean;
  acked: boolean;
  strength: Strength;
  part: NudgeStatus;
}
const keptParts = new WeakMap<SessionSummary, KeptPart>();

/**
 * A session's part (`sessionPart`), kept per summary: a status event changes one session's status, and the switcher rolls up every session on each, so the others are answered from what was kept.
 * Compared by value where a value can be, and by identity for its reasons and the strength order, which are replaced, never changed in place.
 */
function partOf(session: SessionSummary, statuses: ReadonlyMap<string, string>, acked: ReadonlySet<string>, needsYou: ReadonlyMap<string, readonly NeedsYou[]>, muted: ReadonlySet<string>, strength: Strength): NudgeStatus {
  const key = entityKey(session);
  const now = { status: statuses.get(session.id), reasons: needsYou.get(key), muted: muted.has(key), acked: acked.has(session.id), strength };
  const kept = keptParts.get(session);
  if (kept && kept.status === now.status && kept.reasons === now.reasons && kept.muted === now.muted && kept.acked === now.acked && kept.strength === now.strength) return kept.part;
  const part = sessionPart(now.status, now.reasons ?? [], now.muted, now.acked, strength);
  keptParts.set(session, { ...now, part });
  return part;
}

export function rollUp(
  sessions: readonly SessionSummary[],
  statuses: ReadonlyMap<string, string>,
  acked: ReadonlySet<string>,
  needsYou: ReadonlyMap<string, readonly NeedsYou[]>,
  muted: ReadonlySet<string>,
  strength: Strength,
): RollUp {
  const parts = sessions.map((s) => partOf(s, statuses, acked, needsYou, muted, strength));
  return { asking: parts.filter(asksForYou).length, working: parts.filter((part) => part === 'busy').length, badge: strongestNudge(parts, strength) };
}

/**
 * A roll-up's tooltip, sessions counted `elsewhere` (outside the project on show) or `here` (in what the roll-up is of): what asks for you, else what works, else nothing.
 * "3 sessions in other projects need you", "1 session needs you", "2 sessions in other projects are working".
 */
export function rollUpWords({ asking, working }: RollUp, where: 'elsewhere' | 'here'): string | null {
  const place = where === 'elsewhere' ? ' in other projects' : '';
  const sessions = (n: number): string => `${n} ${n === 1 ? 'session' : 'sessions'}${place}`;
  if (asking > 0) return `${sessions(asking)} ${asking === 1 ? 'needs' : 'need'} you`;
  if (working > 0) return `${sessions(working)} ${working === 1 ? 'is' : 'are'} working`;
  return null;
}
