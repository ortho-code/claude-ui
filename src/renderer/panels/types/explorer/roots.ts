import type { SessionSummary } from '../../../../shared/types';

/** Why a folder is a root of the Explorer, which orders the roots: where the panel looks, a repository inside that folder, another checkout the session worked in, or the repository's main checkout it did not. */
export type RootReason = 'works' | 'nested' | 'checkout' | 'shared';

export interface ExplorerRoot {
  path: string;
  /** What its row calls it: its folder's name, or a repository inside the folder the panel looks in by its path from there. */
  name: string;
  reason: RootReason;
  /** It starts folded, its row saying how many files changed there: a root after the first that the session's record lists no change in, or a repository inside the panel's folder with no change. */
  folded: boolean;
}

/** A repository inside the folder the panel looks in, and whether its read lists a change. */
export interface NestedRepository {
  path: string;
  changed: boolean;
}

/**
 * The Explorer's roots, in their order: `first`, the checkout the panel looks in, which is the one the session works in unless the panel has a folder of its own; then the repositories inside `dir`, the folder it looks in; then the other checkouts of its repository the session's record lists, newest change first, the worktree its mark names last when it changed nothing there; then the repository's main checkout when it is none of those.
 * `first` is null for a folder no repository holds, whose repositories inside it are then the roots.
 * A root after the first that the record lists no change in starts folded, the main checkout then included, as does a repository inside the folder with no change; one the record marks gone is left out, and none is listed twice.
 * With no session, a panel with a folder of its own, no checkout of the session's is.
 */
export function explorerRoots(first: string | null, dir: string, session: Pick<SessionSummary, 'repoRoot' | 'isRepo' | 'checkouts'> | null, nested: readonly NestedRepository[]): ExplorerRoot[] {
  const roots: ExplorerRoot[] = first ? [{ path: first, name: folderName(first), reason: 'works', folded: false }] : [];
  const listed = new Set(roots.map((root) => root.path));
  const add = (root: ExplorerRoot): void => {
    if (listed.has(root.path)) return;
    listed.add(root.path);
    roots.push(root);
  };
  for (const repository of nested) add({ path: repository.path, name: repository.path.slice(dir.length).replace(/^\/+/, ''), reason: 'nested', folded: !repository.changed });
  if (!first || !session) return roots;
  for (const checkout of session.checkouts) {
    if (!checkout.gone) add({ path: checkout.root, name: folderName(checkout.root), reason: 'checkout', folded: checkout.at === '' });
  }
  if (session.isRepo) add({ path: session.repoRoot, name: folderName(session.repoRoot), reason: 'shared', folded: true });
  return roots;
}

/** A folder's own name, the last part of its path. */
function folderName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1) || path;
}
