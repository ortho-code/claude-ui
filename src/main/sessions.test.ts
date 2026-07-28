import { describe, it, expect, beforeAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

// A temp HOME whose ~/.claude/projects we fill with fixtures. Created in vi.hoisted so it exists
// before the node:os mock factory (which closes over it) and before sessions.ts loads.
const { testHome } = vi.hoisted(() => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-sess-')) as string };
});

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testHome };
});

import { listSessions } from './sessions';

const projectsDir = path.join(testHome, '.claude', 'projects');

function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

beforeAll(async () => {
  const dir = path.join(projectsDir, '-tmp-proj');
  await fs.mkdir(dir, { recursive: true });

  // Custom title wins over the AI title.
  await fs.writeFile(
    path.join(dir, 'a.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ua', cwd: '/tmp/projA', message: { content: 'first message A' } },
      { type: 'ai-title', aiTitle: 'AI Title A' },
      { type: 'custom-title', customTitle: 'Custom A' },
    ),
  );

  // No custom title: falls back to the AI title.
  await fs.writeFile(
    path.join(dir, 'b.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ub', cwd: '/tmp/projB', message: { content: 'hi B' } },
      { type: 'ai-title', aiTitle: 'AI Title B' },
    ),
  );

  // Empty stub: no user/assistant message -> dropped.
  await fs.writeFile(path.join(dir, 'c.jsonl'), jsonl({ type: 'ai-title', aiTitle: 'Orphan' }));

  // Worktree path fallback: cwd is gone, but the claude -w layout still identifies the repo.
  await fs.writeFile(
    path.join(dir, 'd.jsonl'),
    jsonl({
      type: 'user',
      uuid: 'ud',
      cwd: `${testHome}/.claude/worktrees/wt1`,
      message: { content: 'wt work' },
    }),
  );
});

describe('listSessions', () => {
  it('summarizes titles, conversation key and first message', async () => {
    const sessions = await listSessions();
    const byId = new Map(sessions.map((s) => [s.id, s]));

    expect(byId.get('a')?.title).toBe('Custom A');
    expect(byId.get('a')?.conversationId).toBe('ua');
    expect(byId.get('a')?.firstMessage).toBe('first message A');

    expect(byId.get('b')?.title).toBe('AI Title B');
  });

  it('drops empty stubs (no user/assistant message)', async () => {
    const sessions = await listSessions();
    expect(sessions.some((s) => s.id === 'c')).toBe(false);
  });

  it('attributes a removed worktree to its repo via the .claude/worktrees path', async () => {
    const sessions = await listSessions();
    const d = sessions.find((s) => s.id === 'd');
    expect(d?.worktree).toBe('wt1');
    expect(d?.repoRoot).toBe(testHome);
  });

  it('uses the cwd as the group root when it is not a git repo', async () => {
    const sessions = await listSessions();
    const a = sessions.find((s) => s.id === 'a');
    expect(a?.repoRoot).toBe('/tmp/projA');
    expect(a?.worktree).toBe('');
  });
});
