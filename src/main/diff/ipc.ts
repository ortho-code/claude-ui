import { ipcMain } from 'electron';
import type { DiffQuestion } from '../../shared/diff/types';
import { resolveRepo } from '../sessions/repo';
import { keepBase } from '../sessions/diff-bases';
import { baseCount, branchOf, candidates } from './bases';
import { diffCommits, diffSummary, fileDiff } from './read';

/** Keep `ref` as the base of the project `dir` is in, or of the branch it has out, or clear it with `null`; a detached checkout has no branch to keep one for. */
async function setDiffBase(dir: string, scope: 'branch' | 'project', ref: string | null): Promise<void> {
  const [{ repoRoot }, branch] = await Promise.all([resolveRepo(dir), branchOf(dir)]);
  if (scope === 'branch' && branch === null) throw new Error('This checkout has no branch out, so a base cannot be kept for it.');
  await keepBase(repoRoot, scope === 'branch' ? branch : null, ref);
}

export function registerDiffIpc(): void {
  ipcMain.handle('diff:summary', (_event, dir: string, question: DiffQuestion) => diffSummary(dir, question));
  ipcMain.handle('diff:file', (_event, dir: string, against: string, file: string, from: string | null, context: number, ignoreWs: boolean) => fileDiff(dir, against, file, from, context, ignoreWs));
  ipcMain.handle('diff:commits', (_event, dir: string, against: string) => diffCommits(dir, against));
  ipcMain.handle('diff:baseCandidates', (_event, dir: string) => candidates(dir));
  ipcMain.handle('diff:baseCount', (_event, dir: string, ref: string) => baseCount(dir, ref));
  ipcMain.handle('meta:setDiffBase', (_event, dir: string, scope: 'branch' | 'project', ref: string | null) => setDiffBase(dir, scope, ref));
}
