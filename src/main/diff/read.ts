import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseNameStatus, parseNumstat, parseUnified } from '../../shared/diff/parse';
import type { DiffCommit, DiffFile, DiffQuestion, DiffSummary, FileDiff, PathCheckout } from '../../shared/diff/types';
import { markWords } from '../../shared/diff/words';
import { git } from '../git';
import { againstOf, baseOf, branchOf, countsOf } from './bases';

/**
 * A checkout's changes for the Explorer, read from git: the files a question lists, and one file's hunks.
 * The whole working tree of the checkout the folder is in, untracked files included, with paths relative to its root.
 */

/** The most a whole file's diff or a listing of the files may print. */
const DIFF_CAP = 32 * 1024 * 1024;

/** The largest file read from disk for the folds; past it a fold asks git for more context instead. */
const READ_CAP = 2 * 1024 * 1024;

/** How many untracked files are listed one by one; the rest are counted, since a build folder git does not ignore would be thousands of rows. */
const UNTRACKED_CAP = 500;

/** How many paths go to one `check-attr` call, to stay clear of the system's limit on a command line. */
const ATTR_BATCH = 500;

/** How many commits the header lists; one more is asked for, so a list cut short is told from one exactly this long. */
const COMMITS_CAP = 50;

/** Lockfiles by name, which every package manager writes and nobody reviews; a repository can still say otherwise with `linguist-generated=false`. */
const LOCKFILES = new Set(['Cargo.lock', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'composer.lock', 'Gemfile.lock', 'poetry.lock', 'uv.lock', 'Pipfile.lock', 'go.sum', 'mix.lock', 'pubspec.lock', 'flake.lock']);

/** Flags every diff here takes: no colour or external diff tool the person's config may ask for, and renames found. */
const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '-M'];

const text = async (dir: string, args: string[]): Promise<string> => (await git(dir, args, DIFF_CAP)).toString('utf8');

const rootOf = async (dir: string): Promise<string> => (await text(dir, ['rev-parse', '--show-toplevel'])).trim();

/** Every untracked file, one each, as `status --porcelain=v2` lists them with `?`. */
async function untrackedOf(root: string): Promise<string[]> {
  const out = await text(root, ['status', '--porcelain=v2', '--untracked-files=all', '-z']);
  return out.split('\0').filter((record) => record.startsWith('? ')).map((record) => record.slice(2));
}

/**
 * Which of `paths` are generated: git's `linguist-generated` where the repository sets it either way, else whether it is a lockfile by name.
 * The attribute is GitHub's own, so a file a repository folds in its pull requests folds here with nothing new to set.
 */
async function generatedOf(root: string, paths: string[]): Promise<Set<string>> {
  const generated = new Set<string>();
  for (let at = 0; at < paths.length; at += ATTR_BATCH) {
    const batch = paths.slice(at, at + ATTR_BATCH);
    const fields = (await text(root, ['check-attr', '-z', 'linguist-generated', '--', ...batch])).split('\0');
    for (let i = 0; i + 2 < fields.length; i += 3) {
      const [file, , value] = [fields[i]!, fields[i + 1]!, fields[i + 2]!];
      const byName = LOCKFILES.has(path.posix.basename(file));
      if (value === 'set' || value === 'true' || (value === 'unspecified' && byName)) generated.add(file);
    }
  }
  return generated;
}

/** Git's status letter as the list shows it: a change of type, such as a file becoming a link, reads as modified, and a copy as a new file, which is also how `-M` alone reports one. */
function statusOf(letter: string): DiffFile['status'] {
  if (letter === 'C') return 'A';
  return letter === 'A' || letter === 'D' || letter === 'R' ? letter : 'M';
}

/** The files a diff against `against` lists, untracked files after them, each one row, sorted by path within each part. */
async function filesOf(root: string, against: string): Promise<{ files: DiffFile[]; untrackedLeftOut: number }> {
  const [numstat, names, untracked] = await Promise.all([
    text(root, ['diff', ...DIFF_FLAGS, '--numstat', '-z', against]),
    text(root, ['diff', ...DIFF_FLAGS, '--name-status', '-z', against]),
    untrackedOf(root),
  ]);
  const statuses = parseNameStatus(names);
  const tracked = parseNumstat(numstat).map((row): Omit<DiffFile, 'generated'> => {
    const named = statuses.get(row.path);
    return { path: row.path, from: row.from ?? named?.from ?? null, status: statusOf(named?.status ?? (row.from ? 'R' : 'M')), added: row.added ?? 0, deleted: row.deleted ?? 0, binary: row.added === null };
  });
  const listed = new Set(tracked.map((file) => file.path));
  const fresh = untracked.filter((file) => !listed.has(file)).sort();
  const shown = fresh.slice(0, UNTRACKED_CAP).map((file): Omit<DiffFile, 'generated'> => ({ path: file, from: null, status: 'U', added: 0, deleted: 0, binary: false }));
  const all = [...tracked.sort((a, b) => a.path.localeCompare(b.path)), ...shown];
  const generated = await generatedOf(root, all.map((file) => file.path));
  return { files: all.map((file) => ({ ...file, generated: generated.has(file.path) })), untrackedLeftOut: fresh.length - shown.length };
}

/** The files `question` lists for the checkout `dir` is in, with the base, the commit it is measured against and the commit counts. */
export async function diffSummary(dir: string, question: DiffQuestion): Promise<DiffSummary> {
  const root = await rootOf(dir);
  const [{ base, missing }, branch] = await Promise.all([baseOf(root), branchOf(root)]);
  const [against, counts] = await Promise.all([againstOf(root, question, base), countsOf(root, base)]);
  const { files, untrackedLeftOut } = against === null ? { files: [], untrackedLeftOut: 0 } : await filesOf(root, against);
  return { root, branch, against, base, missing, files, untrackedLeftOut, counts };
}

/** The diff of two files git need not know, run in `dir`: `--no-index` exits 1 when the two differ, so its output comes with that exit. */
export async function noIndexDiff(dir: string, flags: string[], from: string, to: string): Promise<string> {
  try {
    return await text(dir, ['diff', '--no-color', '--no-ext-diff', ...flags, '--no-index', '--', from, to]);
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: unknown };
    if (failed.code === 1 && Buffer.isBuffer(failed.stdout)) return failed.stdout.toString('utf8');
    throw error;
  }
}

/** An untracked file as added from nothing. */
const untrackedDiff = (root: string, file: string, context: number): Promise<string> => noIndexDiff(root, [`-U${context}`], '/dev/null', file);

/** The file at `full` on disk line by line, without the empty line after a final newline; null past `READ_CAP` or when it cannot be read. */
export async function fileLines(full: string): Promise<string[] | null> {
  try {
    if ((await fs.stat(full)).size > READ_CAP) return null;
    const content = await fs.readFile(full, 'utf8');
    if (content === '') return [];
    return (content.endsWith('\n') ? content.slice(0, -1) : content).split('\n').map((line) => line.replace(/\r$/, ''));
  } catch {
    return null;
  }
}

/**
 * The part of a diff that is about `file`: given a rename's old path too, git prints two files when it does not pair them as a rename (too little alike), the old one as deleted.
 * A section is picked by its header's new path, `b/<file>`; a header git quoted for unusual characters matches none, and then the whole diff is the section, as one file's is.
 */
function sectionFor(raw: string, file: string): string {
  const sections = raw.split(/^(?=diff --git )/m);
  return sections.find((section) => section.slice(0, section.indexOf('\n')).endsWith(` b/${file}`)) ?? raw;
}

/**
 * One file's hunks against `against`, with `context` unchanged lines around each change and, with `ignoreWs`, whitespace-only changes left out (`-w`).
 * `from` is a rename's old path, which git must be given too, or the new path alone hides the other half and the whole file reads as added.
 * A file with no hunks is asked about once more as untracked, since git's diff says nothing at all about a file it has never seen.
 */
export async function fileDiff(dir: string, against: string, file: string, from: string | null, context: number, ignoreWs: boolean): Promise<FileDiff> {
  const root = await rootOf(dir);
  const args = ['diff', ...DIFF_FLAGS, `-U${context}`, ...(ignoreWs ? ['-w'] : []), against, '--', ...(from ? [from] : []), file];
  let parsed = parseUnified(sectionFor(await text(root, args), file));
  if (!parsed.hunks.length && !parsed.binary && (await untrackedOf(root)).includes(file)) parsed = parseUnified(await untrackedDiff(root, file, context));
  for (const hunk of parsed.hunks) markWords(hunk.rows);
  return { path: file, hunks: parsed.hunks, binary: parsed.binary, lines: await fileLines(path.join(root, file)) };
}

/**
 * The checkout an absolute path is in, and the path from its root, through the real folders on the way; null for a path no repository holds, for one its repository ignores, which git has nothing to compare with, and for one in git's own folder, which is in no working tree.
 * A path whose folder is gone is asked about from the nearest folder above it that is there.
 */
export async function pathCheckout(file: string): Promise<PathCheckout | null> {
  let dir = path.dirname(file);
  while (!(await fs.stat(dir).then((stat) => stat.isDirectory(), () => false))) {
    if (path.dirname(dir) === dir) return null;
    dir = path.dirname(dir);
  }
  let root: string;
  try {
    root = await rootOf(dir);
  } catch {
    return null;
  }
  const relative = path.relative(root, path.join(await fs.realpath(dir), path.relative(dir, file)));
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const ignored = await git(root, ['check-ignore', '-q', '--', relative], DIFF_CAP).then(
    () => true,
    () => false,
  );
  return ignored ? null : { root, file: relative };
}

/** The commits between `against` and `HEAD`, newest first, without merges, up to one past `COMMITS_CAP`. */
export async function diffCommits(dir: string, against: string): Promise<DiffCommit[]> {
  const out = await text(dir, ['log', '--no-merges', `-n${COMMITS_CAP + 1}`, '--format=%h%x00%s', `${against}..HEAD`, '--']);
  return out.split('\n').flatMap((line) => {
    const [sha, subject] = line.split('\0');
    return sha ? [{ sha, subject: subject ?? '' }] : [];
  });
}
