import type { SessionSummary } from '../../shared/types';

// The stable key for a displayed session entity: the session's own id, always.
// It is immutable, so pins/finished marks/tabs can never go stale — a conversation-derived key stopped matching its session the moment the session gained a sibling.
// conversationId remains the SIGNAL that groups a family (isSibling/siblingIds, derived in the main process) but no longer names anything.
export function entityKey(s: SessionSummary): string {
  return s.id;
}

// One entry per entity key.
// Keys are unique per session file today, so this is a plain index; the latest-activity preference only matters if the same id ever appears twice in a listing.
export function sessionsByKey(sessions: SessionSummary[]): Map<string, SessionSummary> {
  const byKey = new Map<string, SessionSummary>();
  for (const s of sessions) {
    const key = entityKey(s);
    const prev = byKey.get(key);
    if (!prev || s.lastActivity > prev.lastActivity) byKey.set(key, s);
  }
  return byKey;
}

/**
 * Whether each field a session carries can change what the sidebar DRAWS.
 *
 * The annotation is doing real work: `Record<keyof SessionSummary, boolean>` makes this exhaustive, so adding a field to SessionSummary fails to compile until somebody says whether the list has to redraw for it.
 * That is the point — a hand-kept list of "the fields that matter" cannot be checked, and it was wrong.
 */
const AFFECTS_ROW: Record<keyof SessionSummary, boolean> = {
  id: true,
  conversationId: true,
  cwd: true,
  repoRoot: true,
  isRepo: true,
  worktree: true,
  // Drawn as the muted worktree mark, and it can change while the app runs, when a session leaves its worktree.
  leftWorktree: true,
  // The mark's tooltip says which way it left.
  movedOutOfWorktree: true,
  // Not drawn on the row, but the panels read it from the tab, and a tab hears of a re-read session only when its row would change (`sameTabs`, state/app.ts).
  workCwd: true,
  // Drawn as the worktree mark's count and list, and a running session changes files in another checkout.
  checkouts: true,
  title: true,
  firstMessage: true,
  // The row prints it, and switching model mid-session used to leave the old one there until something else moved.
  model: true,
  // Both shown as the sibling mark, and both can change MID-session when a fork lands.
  isSibling: true,
  siblingIds: true,
  // Drawn as the PR mark, and a running session can link one.
  prs: true,
  // Not drawn, but the window asks GitHub for the PR each one becomes, so a new one has to reach the store.
  webCreates: true,
  // Both change what the row IS — a session whose folder is gone cannot be opened, and says so — and both can flip while the app is running, with nothing in the transcript moving to announce it.
  cwdExists: true,
  repoRootExists: true,
  // Drawn as the row's time, the one field drawn that is not here: that time ages with the clock whatever the listing does, so the row asks for it every minute instead (moments.ts).
  // A running session rewrites it constantly, and a repaint for it would make the guard useless.
  lastActivity: false,
  // Main-process bookkeeping that links a fork of a compacted session into its family.
  // The renderer never reads it.
  postCompactHeads: false,
};

const SIGNATURE_FIELDS = (Object.keys(AFFECTS_ROW) as (keyof SessionSummary)[]).filter((k) => AFFECTS_ROW[k]);

/** One session's line of the signature: every field that affects a row. */
function rowLine(session: SessionSummary): string {
  return SIGNATURE_FIELDS.map((k) => fieldText(session[k])).join('\0');
}

/** A field as text for the signature: `String` reads a list of objects, such as `prs`, as `[object Object]` whatever they hold, so one swapped for another would not move it. */
function fieldText(value: SessionSummary[keyof SessionSummary]): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}

/**
 * The list's structure: one line per session, over every field that affects a row.
 *
 * `refreshFromDisk` skips the whole render when this is unchanged, so anything drawn but missing here goes stale until something unrelated moves — it FREEZES a row rather than churning it, which is the harder failure to notice.
 * Getting it wrong is not hypothetical: `model` was missing, and the same gap is why a mid-session worktree move or a new sibling only appeared at the next unrelated change.
 */
export function structuralSignature(sessions: SessionSummary[]): string {
  return sessions.map(rowLine).sort().join('\n');
}

/** Whether two summaries of a session draw the same row — and so the same tab, which shows less of it. */
export function sameRow(a: SessionSummary, b: SessionSummary): boolean {
  return a === b || rowLine(a) === rowLine(b);
}

/**
 * Why a session cannot be started, or null when it can.
 *
 * ONE wording for every surface that has to say it — the tooltip on a row you cannot click, the toast when you click its tab anyway, and the pane of a tab you are already sitting on.
 * They answer the same question at three different moments, so they say the same words; three copies of this sentence would drift the first time one of them was reworded.
 *
 * The two cases are worth telling apart.
 * A missing WORKTREE leaves the repo intact and can be cut again at the same path, which is a thing to go and do; a missing PROJECT means the whole checkout is gone and nothing under it can run.
 */
export function unstartableReason(session: SessionSummary): string | null {
  if (session.cwdExists) return null;
  if (session.worktree && session.repoRootExists) {
    return `The worktree “${session.worktree}” is gone, so this session cannot run. Recreate it at ${session.cwd} to use this session again.`;
  }
  return `This session's folder is gone, so it cannot run: ${session.cwd}`;
}

/** What a session's worktree mark says, when it has one. */
export interface WorktreeMarkState {
  /** The session neither runs in a worktree nor works in one (`workCwd`), though it ran in one or changed files in one, so the mark is muted. */
  muted: boolean;
  tooltip: string;
  /** How many checkouts its list holds (`checkouts`); 0 when it has none, and then the mark lists nothing. */
  count: number;
}

/**
 * The worktree mark a session carries, or null when it has none: one rule for the row's badge, the tab's mark and the worktree filter, so the three cannot disagree about which sessions are worktree sessions.
 * A session that left its worktree keeps a mark because it still did its work there, which is what the mark is for; so does one that changed files in a worktree it never entered, by path or after a `cd`.
 * In the accent while the session runs in a worktree or works in one, so a session whose panels follow it into a worktree wears it as a worktree session; one in a worktree whose panels follow it into the main checkout keeps the accent, while their header names the main checkout.
 */
export function worktreeMarkState(session: SessionSummary): WorktreeMarkState | null {
  const count = session.checkouts.length;
  if (!session.worktree && !session.leftWorktree && count === 0) return null;
  const work = workWorktree(session);
  const says: string[] = [];
  if (session.worktree) says.push(`Linked git worktree: ${session.worktree}`);
  // The words say which way it left, since closing a session in its worktree is the usual way and moving it out is the rare one; a resume runs where the session is now either way.
  else if (session.leftWorktree) {
    says.push(
      session.movedOutOfWorktree
        ? `Moved out of linked git worktree: ${session.leftWorktree}; now in ${session.cwd}`
        : `Worked in linked git worktree: ${session.leftWorktree} until it closed; resumes in ${session.cwd}`,
    );
  }
  if (session.workCwd) says.push(`its panels follow it into ${work ? `linked git worktree: ${work}` : 'the main checkout'}`);
  if (count > 0) says.push(`${count === 1 ? '1 checkout' : `${count} checkouts`} it worked in`);
  const tooltip = says.join('; ');
  return { muted: !session.worktree && !work, tooltip: `${tooltip.charAt(0).toUpperCase()}${tooltip.slice(1)}`, count };
}

/** The linked worktree a session works in (`workCwd`); '' when that is the main checkout, or the folder the session runs in. */
function workWorktree(session: Pick<SessionSummary, 'workCwd' | 'repoRoot'>): string {
  return session.workCwd ? worktreeAt(session.workCwd, session.repoRoot) : '';
}

/** The linked worktree a checkout's root is, named by its folder as main names a worktree; '' for the main checkout, whose root is the repo's. */
export function worktreeAt(root: string, repoRoot: string): string {
  return root !== repoRoot ? folderName(root) : '';
}

/**
 * Whether a project's folder is still there, answered from the sessions filed under it.
 * Every one of them shares the project's repoRoot, so any of them can answer; `some` rather than `every`, so one stale summary cannot condemn a folder that is there.
 * ONE rule for every surface that asks, so the session list and the switcher cannot disagree about which projects are dead.
 */
export function projectRootExists(sessions: readonly SessionSummary[]): boolean {
  return sessions.some((s) => s.repoRootExists);
}

/** Why nothing can be started in a project whose folder is gone: the one sentence for every surface that says it, as `unstartableReason` is for a session, and shaped like it. */
export function projectGoneReason(repoRoot: string): string {
  return `This project's folder is gone, so nothing in it can run: ${repoRoot}`;
}

// A project's own name on disk: the last path segment of its repo root.
export function folderName(repoRoot: string): string {
  return repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
}

// The one place a session's display label is composed: the name Claude gave it, else its first prompt, else what a session with nothing in it is called, after the folder it runs in.
// Every surface shows the same name this way (docs/architecture/sessions.md § Reading sessions).
export function sessionLabel(session: SessionSummary): string {
  return session.title || session.firstMessage || `New: ${folderName(session.cwd)}`;
}

// A project's display name: the user's rename override if set, else the folder name.
// Used everywhere a project is labelled (project headings, tab bar, switcher); the full path stays available on hover.
export function displayName(repoRoot: string, names?: ReadonlyMap<string, string>): string {
  return names?.get(repoRoot) || folderName(repoRoot);
}

// Short, human label for a model id, parsed generically (no hardcoded model list): the alphabetic segment is the family, the numeric segments (minus the trailing YYYYMMDD date, either id order) are the version.
// So new models need no code change.
// Examples: claude-opus-4-8 -> "Opus 4.8", claude-fable-5 -> "Fable 5", claude-3-5-haiku-20241022 -> "Haiku 3.5".
// Falls back to the raw id only when there's no family word at all; empty in -> empty out.
export function modelLabel(model: string): string {
  if (!model) return '';
  const segs = model.toLowerCase().split('-').filter((s) => s && s !== 'claude');
  const family = segs.filter((s) => /^[a-z]+$/.test(s)).join(' ');
  if (!family) return model;
  const version = segs.filter((s) => /^\d+$/.test(s) && s.length !== 8).join('.');
  const name = family.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  return version ? `${name} ${version}` : name;
}

/**
 * The project a folder belongs to, of the ones given: the one it is, else the deepest one it sits under; null for none.
 * How a panel that runs in a fixed folder finds the project a session it starts belongs in.
 */
export function projectFor(roots: readonly string[], dir: string): string | null {
  let best: string | null = null;
  for (const root of roots) {
    const holds = dir === root || dir.startsWith(`${root}/`);
    if (holds && (best === null || root.length > best.length)) best = root;
  }
  return best;
}
