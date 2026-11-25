import { afterAll, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('../sessions/sessions-home')).electronStub);
vi.mock('node:os', async () => (await import('../sessions/sessions-home')).osStub);

const { resolvePaths } = await import('../../../../src/main/files/resolve');
const { testHome } = await import('../sessions/sessions-home');

const project = path.join(testHome, 'project');
await fs.mkdir(path.join(project, 'src'), { recursive: true });
await fs.writeFile(path.join(project, 'src', 'a.ts'), 'a\n');
await fs.mkdir(path.join(testHome, 'notes'), { recursive: true });
await fs.writeFile(path.join(testHome, 'notes', 'todo.md'), 'todo\n');
afterAll(() => fs.rm(project, { recursive: true, force: true }));

describe('resolvePaths', () => {
  it('answers a file on disk by its absolute path, a relative one from the folder and `~/` from home, and null for a folder or no file', async () => {
    expect(await resolvePaths(project, ['src/a.ts', path.join(project, 'src', 'a.ts'), '~/notes/todo.md', 'src', 'src/gone.ts'])).toEqual([
      path.join(project, 'src', 'a.ts'),
      path.join(project, 'src', 'a.ts'),
      path.join(testHome, 'notes', 'todo.md'),
      null,
      null,
    ]);
  });
});
