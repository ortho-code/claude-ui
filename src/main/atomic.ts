import { promises as fs } from 'node:fs';

/**
 * Replace a file's contents so that a crash mid-write leaves the old contents rather than half of the new: write a temp file beside it, then rename it over the target, which is atomic on the same filesystem.
 * A rename replaces whatever is at the path, so two things are carried across that a plain write would have kept: a symlink is followed and the file it points at is replaced, since a dotfiles setup that links `~/.claude/settings.json` must stay linked; and the file's permission bits are kept.
 * The temp file is `<file>.tmp`, one name per target, so two writes to the same file must not overlap: the caller serialises them, as meta's queue does.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  // Not there yet is the first write: nothing to follow, and the default permissions.
  const target = await fs.realpath(file).catch(() => file);
  const mode = await fs.stat(target).then(
    (stat) => stat.mode & 0o7777,
    () => null,
  );
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, data);
  if (mode !== null) await fs.chmod(tmp, mode);
  await fs.rename(tmp, target);
}
