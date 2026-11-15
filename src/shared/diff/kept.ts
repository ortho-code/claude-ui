import type { DiffBases } from './types';

const isRef = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** The kept bases as read from `meta.json`: a project without a usable entry is dropped, as is a branch whose base is not a ref's name. */
export function keptBasesOf(raw: unknown): Record<string, DiffBases> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, DiffBases> = {};
  for (const [repoRoot, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const { project, branches } = entry as { project?: unknown; branches?: unknown };
    const kept: DiffBases = {
      project: isRef(project) ? project : null,
      branches: Object.fromEntries(Object.entries(branches && typeof branches === 'object' ? (branches as Record<string, unknown>) : {}).filter((pair): pair is [string, string] => isRef(pair[1]))),
    };
    if (kept.project !== null || Object.keys(kept.branches).length) out[repoRoot] = kept;
  }
  return out;
}

/** The kept bases with one project's base set, for the project or for one branch of it, or cleared by `null`; a project left with nothing is taken out. */
export function withKeptBase(all: Record<string, DiffBases>, repoRoot: string, branch: string | null, ref: string | null): Record<string, DiffBases> {
  const now = all[repoRoot] ?? { project: null, branches: {} };
  const branches = { ...now.branches };
  let project = now.project;
  if (branch === null) project = ref;
  else if (ref === null) delete branches[branch];
  else branches[branch] = ref;
  const next = { ...all };
  if (project === null && !Object.keys(branches).length) delete next[repoRoot];
  else next[repoRoot] = { project, branches };
  return next;
}
