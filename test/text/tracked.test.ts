import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tracked } from './tracked';

describe('the files the text rules read', () => {
  // Against a real repository in the system's temp folder, since what is read is git's own answer.
  // Nothing is committed, so nothing is signed, and a fresh repository runs no hook unless a global `core.hooksPath` or template folder adds one.
  it('include a new file before it is staged, and never one git ignores', () => {
    const repo = mkdtempSync(join(tmpdir(), 'claude-ui-tracked-'));
    try {
      execFileSync('git', ['-C', repo, 'init', '-q']);
      writeFileSync(join(repo, '.gitignore'), 'ignored.md\n');
      writeFileSync(join(repo, 'staged.md'), 'staged\n');
      writeFileSync(join(repo, 'new.md'), 'new\n');
      writeFileSync(join(repo, 'ignored.md'), 'ignored\n');
      execFileSync('git', ['-C', repo, 'add', 'staged.md']);
      expect(tracked(/\.md$/, repo).sort((a, b) => a.file.localeCompare(b.file))).toEqual([
        { file: 'new.md', text: 'new\n' },
        { file: 'staged.md', text: 'staged\n' },
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
