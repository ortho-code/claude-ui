import { ipcMain } from 'electron';
import type { DiffQuestion, DiffSummaryRead } from '../../shared/diff/types';
import { failure } from '../git';
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

/** A summary, or git's own words when it cannot give one: a rejection would reach the window wrapped in the bridge's message and git's whole command line. */
async function summaryRead(dir: string, question: DiffQuestion): Promise<DiffSummaryRead> {
  try {
    return { kind: 'summary', summary: await diffSummary(dir, question) };
  } catch (error) {
    return { kind: 'failed', error: failure(error) };
  }
}

export function registerDiffIpc(): void {
  ipcMain.handle('diff:summary', (_event, dir: string, question: DiffQuestion) => summaryRead(dir, question));
  ipcMain.handle('diff:file', (_event, dir: string, against: string, file: string, from: string | null, context: number, ignoreWs: boolean) => fileDiff(dir, against, file, from, context, ignoreWs));
  ipcMain.handle('diff:commits', (_event, dir: string, against: string) => diffCommits(dir, against));
  ipcMain.handle('diff:baseCandidates', (_event, dir: string) => candidates(dir));
  ipcMain.handle('diff:baseCount', (_event, dir: string, ref: string) => baseCount(dir, ref));
  ipcMain.handle('meta:setDiffBase', (_event, dir: string, scope: 'branch' | 'project', ref: string | null) => setDiffBase(dir, scope, ref));
}
