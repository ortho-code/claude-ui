import type { DiffBases } from '../../shared/diff/types';
import { withKeptBase } from '../../shared/diff/kept';
import { readMeta, serialize, update } from './meta-store';

/** The bases kept for a project, by its repoRoot; none kept is an empty entry. */
export function keptBases(repoRoot: string): Promise<DiffBases> {
  return serialize(async () => (await readMeta()).diffBases[repoRoot] ?? { project: null, branches: {} });
}

/** Keep `ref` as the base of a project, or of one of its branches, or clear it with `null`. */
export function keepBase(repoRoot: string, branch: string | null, ref: string | null): Promise<void> {
  return update('setDiffBase', (meta) => {
    meta.diffBases = withKeptBase(meta.diffBases, repoRoot, branch, ref);
  });
}
