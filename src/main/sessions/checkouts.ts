import * as path from 'node:path';
import type { SessionCheckout } from '../../shared/types';
import { checkoutsOf, ignoredIn, isDirectory, realFolder } from './repo';
import type { FileChange, SummaryRead } from './summary';

/** What one listing asks git once, however many transcripts it re-reads: each repo's checkouts. */
export type ListingPass = Map<string, Promise<string[] | null>>;

/** A checkout a session changed a file in: its root, and its newest change there; `gone` for a worktree whose folder is not there, or that git no longer lists. */
interface ChangedCheckout {
  root: string;
  position: number;
  at: string;
  gone: boolean;
}

/** Where a session works, as the listing caches it beside its summary. */
export interface Worked {
  /** Every checkout of its repo the session changed files in, newest first, when one is not the checkout it runs in; empty otherwise, and for a session git could not answer about. */
  checkouts: ChangedCheckout[];
  /** The root of the checkout it works in when that is not the one `cwd` is in, '' otherwise; whether it is still there is asked per listing. */
  work: string;
  /** The root of the worktree its mark names, where it runs or that it left, when `checkouts` has others to list it with; '' otherwise. */
  own: string;
  /** The checkout a list of it alone says nothing about: the worktree its mark names, or for a session without one the checkout it runs in; '' when `checkouts` is empty. */
  alone: string;
}

/**
 * WHERE A SESSION WORKS: the checkouts of its repo it changed files in, and of them the one a panel without a folder of its own runs in.
 * That is the checkout of its newest change, a file git ignores or outside the repo's checkouts passed over, so a session working in a worktree by path or by a Bash `cd` takes its panels there, and back once claude changes a file git does not ignore in the main checkout.
 * Not when it entered or left a worktree after that change, which puts it where `cwd` already says; and not when that change is in a worktree that is gone (`changedCheckouts` says which it can tell), where it falls back to `cwd` rather than to an older checkout, which would be a guess.
 * Nothing when git cannot answer, rather than an answer made without it.
 * `marked` is the folder of the worktree the session's mark names, '' for none, whose root goes with the checkouts for the mark to list them with.
 */
export async function workOf(read: SummaryRead, repoRoot: string, marked: string, pass: ListingPass): Promise<Worked> {
  const none = { checkouts: [], work: '', own: '', alone: '' };
  if (read.changes.length === 0) return none;
  const listed = pass.get(repoRoot) ?? checkoutsOf(repoRoot);
  pass.set(repoRoot, listed);
  const roots = await listed;
  if (!roots) return none;
  // Most sessions change files only in the checkout they run in, or outside the repo, and work where they run whatever git ignores: their paths say so, and git is not asked which files it ignores.
  // Only a path through a link into a checkout, or from one checkout into another, would make the paths say otherwise than their real folders do.
  // Not a session that left a worktree: the checkout it runs in now is one besides the worktree its mark names, listed with it when git shows a change there.
  const runsIn = rootOf(read.summary.cwd, roots);
  const main = roots[0]!;
  if (!read.summary.leftWorktree && !read.changes.some(({ file }) => goneWorktree(file, main, roots) || ![runsIn, ''].includes(rootOf(file, roots)))) return none;
  const checkouts = await changedCheckouts(read.changes, roots);
  if (!checkouts) return none;
  const own = marked ? await checkoutOf(marked, roots) : '';
  const here = rootOf(await realFolder(read.summary.cwd), roots);
  // The answer the shortcut above gives, for a session whose paths reached another checkout but whose changes there git ignores.
  const alone = own || here;
  const newest = checkouts[0];
  if (!newest || newest.gone || newest.position < read.movedAt) return { checkouts, work: '', own, alone };
  return { checkouts, work: here === newest.root ? '' : newest.root, own, alone };
}

/** The root of the checkout a folder is in, through its real path: a gone worktree's by claude's layout, else the longest listed root holding it; '' for none. */
async function checkoutOf(dir: string, roots: string[]): Promise<string> {
  const real = await realFolder(dir);
  return goneWorktree(real, roots[0]!, roots) || rootOf(real, roots);
}

/**
 * The checkouts a session's worktree mark lists (`SessionSummary.checkouts`): those it changed a file in, newest first, and the worktree its mark names, `own`, last when it changed nothing there.
 * Gone when the reading found it so, or its folder is not there at this listing; none at all when the list would hold only `alone`, which it would say nothing about.
 */
export function listedCheckouts({ checkouts, own, alone }: Omit<Worked, 'work'>, exists: ReadonlyMap<string, boolean>): SessionCheckout[] {
  const listed = checkouts.map(({ root, at, gone }) => ({ root, at, gone: gone || !exists.get(root), own: root === own }));
  if (own && !listed.some((checkout) => checkout.own)) listed.push({ root: own, at: '', gone: !exists.get(own), own: true });
  return listed.some(({ root }) => root !== alone) ? listed : [];
}

/**
 * The checkouts a session changed files in, newest first, each at its newest change that counts; null when git could not say which files it ignores.
 * A file under `.claude/worktrees/<name>/` of a worktree git no longer lists is a gone worktree's, not the main checkout's it would otherwise fall in, and so is one in a listed worktree whose folder was removed by hand, which git lists as prunable until it is pruned.
 */
async function changedCheckouts(changes: FileChange[], roots: string[]): Promise<ChangedCheckout[] | null> {
  // `checkoutsOf` answers no empty list.
  const main = roots[0]!;
  const byRoot = new Map<string, ChangedCheckout>();
  const note = (root: string, change: FileChange, gone: boolean): void => {
    if (!byRoot.has(root)) byRoot.set(root, { root, position: change.position, at: change.at, gone });
  };
  const toCheck = new Map<string, FileChange[]>();
  for (const change of changes) {
    const file = path.join(await realFolder(path.dirname(change.file)), path.basename(change.file));
    const gone = goneWorktree(file, main, roots);
    if (gone) {
      note(gone, change, true);
      continue;
    }
    const root = rootOf(file, roots);
    if (root) toCheck.set(root, [...(toCheck.get(root) ?? []), { ...change, file }]);
  }
  for (const [root, inRoot] of toCheck) {
    if (!(await isDirectory(root))) {
      note(root, inRoot[0]!, true);
      continue;
    }
    const ignored = await ignoredIn(root, inRoot.map(({ file }) => file));
    if (!ignored) return null;
    const counted = inRoot.find(({ file }) => !ignored.has(file));
    if (counted) note(root, counted, false);
  }
  return [...byRoot.values()].sort((a, b) => b.position - a.position);
}

/** The root of the gone worktree a path is in, by claude's `<repo>/.claude/worktrees/<name>` layout, when git does not list that worktree; '' otherwise. */
function goneWorktree(file: string, main: string, roots: string[]): string {
  const worktrees = path.join(main, '.claude', 'worktrees');
  if (!file.startsWith(`${worktrees}/`)) return '';
  const root = path.join(worktrees, file.slice(worktrees.length + 1).split('/')[0]!);
  return roots.includes(root) ? '' : root;
}

/** The root of the checkout a path is in: the longest of `roots` that holds it, or is it; '' for none. */
function rootOf(file: string, roots: string[]): string {
  return roots.filter((root) => file === root || file.startsWith(`${root}/`)).reduce((longest, root) => (root.length > longest.length ? root : longest), '');
}
