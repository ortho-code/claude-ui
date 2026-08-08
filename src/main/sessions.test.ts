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

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() }, app: { getPath: () => testHome } }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testHome };
});

import { listSessions, deriveForkLineage } from './sessions';

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

  // Model: keep the LATEST an assistant message reported (a mid-session switch sonnet -> opus).
  await fs.writeFile(
    path.join(dir, 'g.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ug', cwd: '/tmp/projG', message: { content: 'go' } },
      { type: 'assistant', uuid: 'ag1', message: { model: 'claude-sonnet-4-5-20250929', content: 'a' } },
      { type: 'assistant', uuid: 'ag2', message: { model: 'claude-opus-4-20250514', content: 'b' } },
    ),
  );

  // Fork: p2 shares p1's first-message uuid and extends its transcript, so p2 is a fork of p1.
  const forkBase = [
    { type: 'user', uuid: 'uf', cwd: '/tmp/projF', message: { content: 'orig' } },
    { type: 'assistant', uuid: 'af1', message: { content: 'r1' } },
  ];
  await fs.writeFile(path.join(dir, 'p1.jsonl'), jsonl(...forkBase));
  await fs.writeFile(path.join(dir, 'p2.jsonl'), jsonl(...forkBase, { type: 'assistant', uuid: 'af2', message: { content: 'r2 (fork)' } }));
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

  it('keeps the latest model reported across the transcript', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'g')?.model).toBe('claude-opus-4-20250514');
  });

  it('drops empty stubs (no user/assistant message)', async () => {
    const sessions = await listSessions();
    expect(sessions.some((s) => s.id === 'c')).toBe(false);
  });

  it('detects a fork across files sharing a first-message uuid', async () => {
    const sessions = await listSessions();
    const p1 = sessions.find((s) => s.id === 'p1');
    const p2 = sessions.find((s) => s.id === 'p2');
    expect(p1?.isFork).toBe(false);
    expect(p1?.forkCount).toBe(1);
    expect(p2?.isFork).toBe(true);
    expect(p2?.parentId).toBe('p1');
  });

  it('attributes a removed worktree to its repo via the .claude/worktrees path', async () => {
    const sessions = await listSessions();
    const d = sessions.find((s) => s.id === 'd');
    expect(d?.worktree).toBe('wt1');
    expect(d?.repoRoot).toBe(testHome);
    expect(d?.isRepo).toBe(true);
  });

  it('uses the cwd as the group root when it is not a git repo', async () => {
    const sessions = await listSessions();
    const a = sessions.find((s) => s.id === 'a');
    expect(a?.repoRoot).toBe('/tmp/projA');
    expect(a?.worktree).toBe('');
    expect(a?.isRepo).toBe(false);
  });

  it('re-reads a file after it changes (mtime+size cache invalidation)', async () => {
    const file = path.join(projectsDir, '-tmp-proj', 'e.jsonl');
    const write = (title: string) =>
      fs.writeFile(
        file,
        jsonl(
          { type: 'user', uuid: 'ue', cwd: '/tmp/projE', message: { content: 'e' } },
          { type: 'custom-title', customTitle: title },
        ),
      );
    await write('First');
    expect((await listSessions()).find((s) => s.id === 'e')?.title).toBe('First');
    // Rewrite with different content (size changes) — the cached summary must not be reused.
    await write('Second');
    expect((await listSessions()).find((s) => s.id === 'e')?.title).toBe('Second');
  });
});

describe('deriveForkLineage', () => {
  const m = (id: string, uuidSeq: string[], createdMs: number, hasCompact = false, lastActivity = 't') => ({
    id, uuidSeq, hasCompact, createdMs, lastActivity,
  });

  it('attributes two forks of one parent to that parent, not to each other', () => {
    // base kept going after each fork; b forked early, c forked late. Both share more with base
    // than with each other, so both attach to base (no chain).
    const r = deriveForkLineage([
      m('base', ['a', 'b', 'c', 'd', 'e'], 1),
      m('b', ['a', 'b', 'p', 'q'], 2),
      m('c', ['a', 'b', 'c', 'd', 'e', 'z'], 3),
    ]);
    expect(r.get('base')).toEqual({ isFork: false, parentId: null });
    expect(r.get('b')?.parentId).toBe('base');
    expect(r.get('c')?.parentId).toBe('base');
  });

  it('attributes to the parent even when the parent has a message the fork lacks (a duplicate)', () => {
    // base has a stray uuid 'dup' (e.g. a resubmitted message) that the fork never copied; set
    // overlap still makes base the clear parent, where positional prefix would misfire.
    const r = deriveForkLineage([
      m('base', ['a', 'b', 'c', 'dup'], 1),
      m('fork', ['a', 'b', 'c', 'x', 'y'], 2),
    ]);
    expect(r.get('fork')).toEqual({ isFork: true, parentId: 'base' });
  });

  it('resolves a real fork-of-fork chain to the immediate parent', () => {
    // f1 contains base; f2 contains f1 — so f2 overlaps f1 more than base and chains to it.
    const r = deriveForkLineage([
      m('base', ['a', 'b'], 1),
      m('f1', ['a', 'b', 'c'], 2),
      m('f2', ['a', 'b', 'c', 'd'], 3),
    ]);
    expect(r.get('base')).toEqual({ isFork: false, parentId: null });
    expect(r.get('f1')?.parentId).toBe('base');
    expect(r.get('f2')?.parentId).toBe('f1');
  });

  it('orients parent by creation time when the message sets are equal (a just-created copy)', () => {
    const r = deriveForkLineage([m('base', ['a', 'b'], 1), m('fork', ['a', 'b'], 2)]);
    expect(r.get('fork')).toEqual({ isFork: true, parentId: 'base' });
    expect(r.get('base')).toEqual({ isFork: false, parentId: null });
  });

  it('never treats a compaction branch as a fork', () => {
    const r = deriveForkLineage([m('base', ['a', 'b'], 1), m('compact', ['a', 'b', 'c'], 2, true)]);
    expect(r.get('compact')).toEqual({ isFork: false, parentId: null });
    expect(r.get('base')).toEqual({ isFork: false, parentId: null });
  });
});

// These run after the listSessions suite, so they build on its p1/p2 fork family fixture.
describe('fork lineage cache', () => {
  it('persists the derived lineage to disk', async () => {
    await listSessions();
    const cache = JSON.parse(await fs.readFile(path.join(testHome, 'fork-lineage.json'), 'utf8'));
    expect(cache.version).toBe(1);
    // p1/p2 share first-message uuid 'uf', so that is their conversation key.
    expect(cache.conversations.uf.members.p2.isFork).toBe(true);
    expect(cache.conversations.uf.members.p1.forkCount).toBe(1);
  });

  it('recomputes when a new branch joins the family (the file set changed)', async () => {
    // p3 forks p1 too: same copied prefix, its own extra message. Added after the family was cached,
    // so the set-keyed entry must invalidate and pick it up.
    await fs.writeFile(
      path.join(projectsDir, '-tmp-proj', 'p3.jsonl'),
      jsonl(
        { type: 'user', uuid: 'uf', cwd: '/tmp/projF', message: { content: 'orig' } },
        { type: 'assistant', uuid: 'af1', message: { content: 'r1' } },
        { type: 'assistant', uuid: 'af3', message: { content: 'r3 (another fork)' } },
      ),
    );
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'p3')?.isFork).toBe(true);
    expect(sessions.find((s) => s.id === 'p3')?.parentId).toBe('p1');
    expect(sessions.find((s) => s.id === 'p1')?.forkCount).toBe(2);
  });
});
