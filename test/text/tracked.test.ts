import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tracked } from './tracked';

// Against a real repository in the system's temp folder, since what is read is git's own answer.
// Nothing is committed, so nothing is signed, and a fresh repository runs no hook unless a global `core.hooksPath` or template folder adds one.

/** What `tracked` reads of the `.md` files in a fresh repository, once `setup` has filled it, in path order. */
function readIn(setup: (at: (file: string) => string, git: (args: string[], input?: string) => string) => void): { file: string; text: string }[] {
  const repo = mkdtempSync(join(tmpdir(), 'claude-ui-tracked-'));
  try {
    const git = (args: string[], input?: string): string => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', input });
    git(['init', '-q']);
    setup((file) => join(repo, file), git);
    return tracked(/\.md$/, repo).sort((a, b) => a.file.localeCompare(b.file));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe('the files the text rules read', () => {
  it('include a new file before it is staged, and never one git ignores', () => {
    const read = readIn((at, git) => {
      writeFileSync(at('.gitignore'), 'ignored.md\n');
      writeFileSync(at('staged.md'), 'staged\n');
      writeFileSync(at('new.md'), 'new\n');
      writeFileSync(at('ignored.md'), 'ignored\n');
      git(['add', 'staged.md']);
    });
    expect(read).toEqual([
      { file: 'new.md', text: 'new\n' },
      { file: 'staged.md', text: 'staged\n' },
    ]);
  });

  it('leave out a link to a folder, which is no file to read', () => {
    const read = readIn((at) => {
      mkdirSync(at('folder'));
      symlinkSync('folder', at('link.md'));
      writeFileSync(at('kept.md'), 'kept\n');
    });
    expect(read).toEqual([{ file: 'kept.md', text: 'kept\n' }]);
  });

  it('leave out a link that points to itself, which is no file to read', () => {
    const read = readIn((at) => {
      symlinkSync('loop.md', at('loop.md'));
      writeFileSync(at('kept.md'), 'kept\n');
    });
    expect(read).toEqual([{ file: 'kept.md', text: 'kept\n' }]);
  });

  it('leave out a file deleted but still in the index, which is no file to read', () => {
    const read = readIn((at, git) => {
      writeFileSync(at('gone.md'), 'gone\n');
      git(['add', 'gone.md']);
      unlinkSync(at('gone.md'));
      writeFileSync(at('kept.md'), 'kept\n');
    });
    expect(read).toEqual([{ file: 'kept.md', text: 'kept\n' }]);
  });

  it('read a file in a merge conflict once, not once for each of its sides', () => {
    const read = readIn((at, git) => {
      writeFileSync(at('conflict.md'), 'both\n');
      const blob = git(['hash-object', '-w', 'conflict.md']).trim();
      // Up to three entries git leaves in the index for a conflict, the common ancestor's, ours and theirs; here all three.
      git(['update-index', '--index-info'], [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\tconflict.md\n`).join(''));
    });
    expect(read).toEqual([{ file: 'conflict.md', text: 'both\n' }]);
  });
});
