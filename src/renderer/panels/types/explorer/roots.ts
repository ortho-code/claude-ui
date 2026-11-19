import type { SessionSummary } from '../../../../shared/types';

/** Why a folder is a root of the Explorer, which orders the roots: where the panel looks, another checkout the session worked in, or the repository's main checkout it did not. */
export type RootReason = 'works' | 'checkout' | 'shared';

export interface ExplorerRoot {
  path: string;
  reason: RootReason;
  /** It starts folded, its row saying how many files changed there: a root after the first that the session's record lists no change in. */
  folded: boolean;
}

/**
 * The Explorer's roots, in their order: `first`, the checkout the panel looks in, which is the one the session works in unless the panel has a folder of its own; then the other checkouts of its repository its record lists, newest change first, the worktree its mark names last when it changed nothing there; then the repository's main checkout when it is none of those.
 * A root after the first that the record lists no change in starts folded, the main checkout then included; one the record marks gone is left out.
 * With no session, a panel with a folder of its own, `first` alone.
 */
export function explorerRoots(first: string, session: Pick<SessionSummary, 'repoRoot' | 'isRepo' | 'checkouts'> | null): ExplorerRoot[] {
  const roots: ExplorerRoot[] = [{ path: first, reason: 'works', folded: false }];
  if (!session) return roots;
  const listed = new Set([first]);
  for (const checkout of session.checkouts) {
    if (checkout.gone || listed.has(checkout.root)) continue;
    listed.add(checkout.root);
    roots.push({ path: checkout.root, reason: 'checkout', folded: checkout.at === '' });
  }
  if (session.isRepo && !listed.has(session.repoRoot)) roots.push({ path: session.repoRoot, reason: 'shared', folded: true });
  return roots;
}
