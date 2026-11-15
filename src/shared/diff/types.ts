/**
 * What the diff panel is told about a checkout's changes, across the bridge.
 * Paths are relative to the checkout's root, as git prints them.
 */

/** What a diff is taken against: everything since the branch left its base, what no remote has yet, or what is not committed. */
export type DiffQuestion = 'since' | 'unpushed' | 'uncommitted';

/** Where the base of Since branched came from: a pick for this branch, the project's, or the convention's guess. */
export type BaseSource = 'branch' | 'project' | 'convention';

/** The bases kept for one project: its own, and one per branch, which wins over it. */
export interface DiffBases {
  project: string | null;
  branches: Record<string, string>;
}

export interface DiffBase {
  ref: string;
  source: BaseSource;
}

export interface DiffFile {
  path: string;
  /** A rename's old path. */
  from: string | null;
  /** Git's letter: modified, added, deleted, renamed, or untracked. */
  status: 'M' | 'A' | 'D' | 'R' | 'U';
  added: number;
  deleted: number;
  binary: boolean;
  /** A lockfile by its name, or a file the repository marks `linguist-generated`. */
  generated: boolean;
}

/** The commit counts the header's menu shows beside each question; null where there is nothing to count against. */
export interface DiffCounts {
  /** Commits since the branch left its base. */
  ahead: number | null;
  /** Commits on the base the branch does not have. */
  behind: number | null;
  /** Commits on no remote. */
  unpushed: number;
}

export interface DiffSummary {
  /** The commit the diff is taken against; null when Since branched has no base to measure from. */
  against: string | null;
  /** The base Since branched is measured from, whichever question this is; null when there is none. */
  base: DiffBase | null;
  /** A kept base that no longer resolves, which gave way to the next one; null when none did. */
  missing: string | null;
  files: DiffFile[];
  /** Untracked files past the cap, which are counted rather than listed. */
  untrackedLeftOut: number;
  counts: DiffCounts;
}

export interface DiffRow {
  kind: 'context' | 'add' | 'del';
  old: number | null;
  new: number | null;
  text: string;
  /** Character ranges of `text` that differ from the line it pairs with; absent for a row that pairs with none. */
  words?: [number, number][];
  /** Git's "No newline at end of file" names this row. */
  noEol?: true;
}

export interface DiffHunk {
  oldStart: number;
  newStart: number;
  /** Git's heading for the hunk, the line it names after the second `@@`; empty when it names none. */
  heading: string;
  /** Unchanged lines between the previous hunk, or the file's start, and this one. */
  gapBefore: number;
  rows: DiffRow[];
}

export interface FileDiff {
  path: string;
  hunks: DiffHunk[];
  binary: boolean;
  /** The file as it is on disk, line by line, which a fold draws its hidden lines from; null when it cannot be read or is past the cap. */
  lines: string[] | null;
}

export interface DiffCommit {
  sha: string;
  subject: string;
}

/** A remote branch the base can be set to; `isDefault` when its remote names it as its default branch. */
export interface BaseCandidate {
  ref: string;
  isDefault: boolean;
}
