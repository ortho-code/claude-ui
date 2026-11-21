import type { BaseCandidate, BaseLayers, DiffBase, DiffCounts, DiffQuestion, KeptLayer } from '../../shared/diff/types';
import { git } from '../git';
import { resolveRepo } from '../sessions/repo';
import { keptBases } from '../sessions/diff-bases';

/**
 * What a diff is taken against, and the base Since branched is measured from.
 * Nothing here fetches: a base is measured as the remote branches stand locally, and moves when the person fetches or rebases.
 */

/** The most a call here prints: a list of refs or commit ids, which a repository with a remote that has thousands of branches keeps well under this. */
const REFS_CAP = 8 * 1024 * 1024;

/**
 * Git's empty tree in this repository, what a diff is taken against when there is no commit to take it against: a branch with no commit yet, or one whose every commit is unpushed back to its root.
 * Asked rather than written down, since its id depends on the repository's object format, SHA-1 or SHA-256; git knows it without it being stored.
 */
export const emptyTreeOf = async (dir: string): Promise<string> => (await text(dir, ['hash-object', '-t', 'tree', '/dev/null'])).trim();

/** The remote whose default branch the convention takes, in order: a fork's original by its usual name, then the remote a clone came from by git's default name. */
const CONVENTION_REMOTES = ['upstream', 'origin'];

/** The branch names taken as a remote's default where git has no `HEAD` for it, in order. */
const MAINLINE_NAMES = ['develop', 'main', 'master'];

const text = async (dir: string, args: string[]): Promise<string> => (await git(dir, args, REFS_CAP)).toString('utf8');

/**
 * A git answer, or null where git refuses with its own exit, as it does for a ref that does not resolve or a detached `HEAD`.
 * Git not answering at all, a timeout or a missing binary, still fails, so it never reads as "no base".
 */
async function maybe(dir: string, args: string[]): Promise<string | null> {
  try {
    return (await text(dir, args)).trim();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 1 || code === 128) return null;
    throw error;
  }
}

/** The branch the checkout has out, or null for a detached one. */
export const branchOf = (dir: string): Promise<string | null> => maybe(dir, ['symbolic-ref', '--short', '-q', 'HEAD']).then((out) => out || null);

/**
 * Every local and remote branch that is no symbolic ref, by git's short name, local ones first as git lists them, which ones a remote's `HEAD` names as its default, and which are local, a branch stacked on another being measured from a local one.
 * Only a remote's own `HEAD` names a default: any other symbolic ref, such as an alias among the local branches, says nothing about which branch is the mainline.
 */
export async function candidates(dir: string): Promise<BaseCandidate[]> {
  const out = await text(dir, ['for-each-ref', '--format=%(refname)%00%(refname:short)%00%(symref:short)', 'refs/heads', 'refs/remotes']);
  const refs: { ref: string; local: boolean }[] = [];
  const defaults = new Set<string>();
  for (const line of out.split('\n')) {
    const [full, ref, target] = line.split('\0');
    if (!full || !ref) continue;
    if (!target) refs.push({ ref, local: full.startsWith('refs/heads/') });
    else if (full.startsWith('refs/remotes/') && full.endsWith('/HEAD')) defaults.add(target);
  }
  return refs.map(({ ref, local }) => ({ ref, isDefault: defaults.has(ref), local }));
}

/** The convention's base: the default branch of the first of `CONVENTION_REMOTES` the repository has, its `HEAD` where git knows it, else the first of `MAINLINE_NAMES` on it; null when there is none. */
export async function conventionBase(dir: string): Promise<string | null> {
  const listed = (await candidates(dir)).filter((candidate) => !candidate.local);
  for (const remote of CONVENTION_REMOTES) {
    const own = listed.filter((candidate) => candidate.ref.startsWith(`${remote}/`));
    const named = own.find((candidate) => candidate.isDefault) ?? MAINLINE_NAMES.map((name) => own.find((candidate) => candidate.ref === `${remote}/${name}`)).find(Boolean);
    if (named) return named.ref;
  }
  return null;
}

/** Whether `ref` names a commit here. */
const resolves = async (dir: string, ref: string): Promise<boolean> => (await maybe(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) !== null;

/**
 * The base Since branched is measured from, by the first layer that gives one that resolves: this branch's pick, the project's, the convention's.
 * `missing` names a kept base that no longer resolves and gave way, which the header says.
 */
export async function baseOf(dir: string): Promise<{ base: DiffBase | null; missing: string | null }> {
  const kept = await keptRefs(dir);
  let missing: string | null = null;
  for (const [ref, source] of [[kept.branch, 'branch'], [kept.project, 'project']] as const) {
    if (!ref) continue;
    if (await resolves(dir, ref)) return { base: { ref, source }, missing };
    missing ??= ref;
  }
  const guessed = await conventionBase(dir);
  return { base: guessed ? { ref: guessed, source: 'convention' } : null, missing };
}

/** Each layer as it stands, whichever wins: what the checkout's branch keeps and what its project keeps, each saying whether it is gone, and the convention's guess; the base picker says from these what following the default means. */
export async function baseLayers(dir: string): Promise<BaseLayers> {
  const [kept, guess] = await Promise.all([keptRefs(dir), conventionBase(dir)]);
  const layer = async (ref: string | null): Promise<KeptLayer | null> => (ref ? { ref, gone: !(await resolves(dir, ref)) } : null);
  const [branch, project] = await Promise.all([layer(kept.branch), layer(kept.project)]);
  return { branch, project, guess };
}

/** The bases kept for the branch `dir` has out, none for a detached one, and for its project, whether or not they still resolve. */
async function keptRefs(dir: string): Promise<{ branch: string | null; project: string | null }> {
  const [{ repoRoot }, branch] = await Promise.all([resolveRepo(dir), branchOf(dir)]);
  const kept = await keptBases(repoRoot);
  // Its own entries only: a branch named as a property every object has, such as `constructor`, would otherwise read that property.
  return { branch: branch && Object.hasOwn(kept.branches, branch) ? (kept.branches[branch] ?? null) : null, project: kept.project };
}

/** `HEAD`'s commit, or null on a branch with no commit yet. */
const headOf = (dir: string): Promise<string | null> => maybe(dir, ['rev-parse', '--verify', '--quiet', 'HEAD']);

/** The parent of the oldest commit no remote has, so the diff holds every unpushed commit; `HEAD` when every commit has gone out, and the empty tree when none has. */
async function unpushedFrom(dir: string, head: string): Promise<string> {
  const oldest = (await text(dir, ['rev-list', '--reverse', 'HEAD', '--not', '--remotes'])).split('\n')[0];
  if (!oldest) return head;
  return (await maybe(dir, ['rev-parse', '--verify', '--quiet', `${oldest}^`])) ?? emptyTreeOf(dir);
}

/**
 * The commit a question's diff is taken against, or null for Since branched without a base, or with one that shares no history with `HEAD`.
 * Since branched is the merge-base, not the base's tip, or the base's own newer commits would read as this branch removing them.
 */
export async function againstOf(dir: string, question: DiffQuestion, base: DiffBase | null): Promise<string | null> {
  const head = await headOf(dir);
  if (head === null) return question === 'since' && !base ? null : emptyTreeOf(dir);
  if (question === 'uncommitted') return head;
  if (question === 'unpushed') return unpushedFrom(dir, head);
  return base ? maybe(dir, ['merge-base', base.ref, 'HEAD']) : null;
}

/** How many commits each question counts, for the header's menu: ahead of and behind the base, and on no remote. */
export async function countsOf(dir: string, base: DiffBase | null): Promise<DiffCounts> {
  if ((await headOf(dir)) === null) return { ahead: null, behind: null, unpushed: 0 };
  const [sides, unpushed] = await Promise.all([
    base ? maybe(dir, ['rev-list', '--left-right', '--count', `${base.ref}...HEAD`]) : Promise.resolve(null),
    text(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes']),
  ]);
  const [behind, ahead] = sides ? sides.split(/\s+/).map(Number) : [];
  return { ahead: ahead ?? null, behind: behind ?? null, unpushed: Number(unpushed.trim()) };
}

/** The commits `ref` would count as this branch's own, for a row of the base menu; null when it shares no history with `HEAD`. */
export async function baseCount(dir: string, ref: string): Promise<number | null> {
  const from = await maybe(dir, ['merge-base', ref, 'HEAD']);
  if (from === null) return null;
  return Number((await text(dir, ['rev-list', '--count', `${from}..HEAD`])).trim());
}
