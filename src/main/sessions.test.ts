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

  // Model: keep the LATEST an assistant message reported (a mid-session switch sonnet -> opus).
  await fs.writeFile(
    path.join(dir, 'g.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ug', cwd: '/tmp/projG', message: { content: 'go' } },
      { type: 'assistant', uuid: 'ag1', message: { model: 'claude-sonnet-4-5-20250929', content: 'a' } },
      { type: 'assistant', uuid: 'ag2', message: { model: 'claude-opus-4-20250514', content: 'b' } },
    ),
  );

  // Family: p2 shares p1's first-message uuid (e.g. via --fork-session), so they are siblings.
  const forkBase = [
    { type: 'user', uuid: 'uf', cwd: '/tmp/projF', message: { content: 'orig' } },
    { type: 'assistant', uuid: 'af1', message: { content: 'r1' } },
  ];
  await fs.writeFile(path.join(dir, 'p1.jsonl'), jsonl(...forkBase));
  await fs.writeFile(path.join(dir, 'p2.jsonl'), jsonl(...forkBase, { type: 'assistant', uuid: 'af2', message: { content: 'r2 (fork)' } }));

  // Real compaction: after a structured system/compact_boundary event, the next user/assistant uuid
  // is captured as the post-compaction head.
  await fs.writeFile(
    path.join(dir, 'k.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uk', cwd: '/tmp/projK', message: { content: 'start' } },
      { type: 'system', subtype: 'compact_boundary', uuid: 'kb', compactMetadata: { trigger: 'manual' } },
      { type: 'assistant', uuid: 'khead', message: { content: 'after compaction' } },
    ),
  );

  // Case A: a fork of a COMPACTED session adopts a post-compaction head as its conversationId. q's
  // first message uuid equals k's post-compaction head 'khead', so k and q are one family. The fork
  // copies the parent's boundary event too, so q also claims 'khead' as its OWN head (the real
  // c74279cd shape) — that self-claim must not break the k<->q link.
  await fs.writeFile(
    path.join(dir, 'q.jsonl'),
    jsonl(
      { type: 'system', subtype: 'compact_boundary', uuid: 'qb', compactMetadata: { trigger: 'manual' } },
      { type: 'user', uuid: 'khead', cwd: '/tmp/projK', message: { content: 'fork of compacted' } },
      { type: 'assistant', uuid: 'aq', message: { content: 'carries on' } },
    ),
  );

  // False positive guard: the words appear only in message TEXT, with no real boundary event ->
  // no post-compaction head is captured (the old substring check wrongly flagged this).
  await fs.writeFile(
    path.join(dir, 'm.jsonl'),
    jsonl(
      { type: 'user', uuid: 'um', cwd: '/tmp/projM', message: { content: 'why does compactMetadata match' } },
      { type: 'assistant', uuid: 'am', message: { content: 'we changed the compact_boundary detection' } },
    ),
  );

  // Mid-life worktree entry (EnterWorktree hook): the transcript stays in the original project dir;
  // the last worktree-state event decides where the session lives.
  await fs.writeFile(
    path.join(dir, 'w1.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw1', cwd: '/tmp/projW', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW', preEnterOriginalCwd: '/tmp/projW', worktreePath: `${testHome}/.claude/worktrees/wtg`, worktreeName: 'wtg', hookBased: true } },
    ),
  );
  // ...and one that entered then EXITED (worktreeSession null): back to the original cwd.
  await fs.writeFile(
    path.join(dir, 'w2.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw2', cwd: '/tmp/projW2', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW2', preEnterOriginalCwd: '/tmp/projW2', worktreePath: `${testHome}/.claude/worktrees/wtg2`, worktreeName: 'wtg2', hookBased: true } },
      { type: 'worktree-state', worktreeSession: null },
    ),
  );

  // Slash-command starts: the first message is wrapped in command tags; the row should show the
  // command line the user effectively typed, not the tag soup. Real shapes: with args, and with an
  // empty args tag.
  await fs.writeFile(
    path.join(dir, 'sc1.jsonl'),
    jsonl({
      type: 'user',
      uuid: 'usc1',
      cwd: '/tmp/projSC',
      message: { content: '<command-message>research</command-message>\n<command-name>/research</command-name>\n<command-args>SC-51053 and the big plan</command-args>' },
    }),
  );
  await fs.writeFile(
    path.join(dir, 'sc2.jsonl'),
    jsonl({
      type: 'user',
      uuid: 'usc2',
      cwd: '/tmp/projSC',
      message: { content: '<command-message>compact</command-message>\n<command-name>/compact</command-name>\n<command-args></command-args>' },
    }),
  );

  // lastActivity comes from the last MESSAGE, so a later system event (a background/Remote Control
  // touch) must not push it forward.
  await fs.writeFile(
    path.join(dir, 't.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ut', cwd: '/tmp/projT', message: { content: 'hi' }, timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'assistant', uuid: 'at', message: { content: 'yo' }, timestamp: '2026-01-02T00:00:00.000Z' },
      { type: 'system', subtype: 'informational', content: 'Remote Control disconnected', timestamp: '2026-06-01T00:00:00.000Z' },
    ),
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

  it('keeps the latest model reported across the transcript', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'g')?.model).toBe('claude-opus-4-20250514');
  });

  it('drops empty stubs (no user/assistant message)', async () => {
    const sessions = await listSessions();
    expect(sessions.some((s) => s.id === 'c')).toBe(false);
  });

  it('marks files sharing a first-message uuid as siblings', async () => {
    const sessions = await listSessions();
    const p1 = sessions.find((s) => s.id === 'p1');
    const p2 = sessions.find((s) => s.id === 'p2');
    expect(p1?.isSibling).toBe(true);
    expect(p1?.siblingIds).toEqual(['p2']);
    expect(p2?.isSibling).toBe(true);
    expect(p2?.siblingIds).toEqual(['p1']);
  });

  it('leaves a lone session unmarked', async () => {
    const a = (await listSessions()).find((s) => s.id === 'a');
    expect(a?.isSibling).toBe(false);
    expect(a?.siblingIds).toEqual([]);
  });

  it('captures the post-compaction head after a real compaction boundary', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'k')?.postCompactHeads).toEqual(['khead']);
  });

  it('links a fork of a compacted session to it as a sibling (case A)', async () => {
    // q's conversationId equals k's post-compaction head, so they group despite different keys.
    const sessions = await listSessions();
    const k = sessions.find((s) => s.id === 'k');
    const q = sessions.find((s) => s.id === 'q');
    expect(k?.isSibling).toBe(true);
    expect(k?.siblingIds).toEqual(['q']);
    expect(q?.isSibling).toBe(true);
    expect(q?.siblingIds).toEqual(['k']);
  });

  it('does not flag compaction when the words appear only in message text', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'm')?.postCompactHeads).toEqual([]);
  });

  it('renders a slash-command first message as the typed command line', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'sc1')?.firstMessage).toBe('/research SC-51053 and the big plan');
    expect(sessions.find((s) => s.id === 'sc2')?.firstMessage).toBe('/compact'); // empty args tag
  });

  it('takes lastActivity from the last message, ignoring later system events', async () => {
    const t = (await listSessions()).find((s) => s.id === 't');
    expect(t?.lastActivity).toBe('2026-01-02T00:00:00.000Z'); // last MESSAGE, not the later system event
  });

  it('attributes a removed worktree to its repo via the .claude/worktrees path', async () => {
    const sessions = await listSessions();
    const d = sessions.find((s) => s.id === 'd');
    expect(d?.worktree).toBe('wt1');
    expect(d?.repoRoot).toBe(testHome);
    expect(d?.isRepo).toBe(true);
  });

  it('moves a session into the worktree it entered mid-life (last worktree-state wins)', async () => {
    const w1 = (await listSessions()).find((s) => s.id === 'w1');
    expect(w1?.cwd).toBe(`${testHome}/.claude/worktrees/wtg`);
    expect(w1?.worktree).toBe('wtg');
    expect(w1?.repoRoot).toBe(testHome);
    expect(w1?.isRepo).toBe(true);
  });

  it('drops a session back to its original cwd after it exited the worktree', async () => {
    const w2 = (await listSessions()).find((s) => s.id === 'w2');
    expect(w2?.cwd).toBe('/tmp/projW2');
    expect(w2?.worktree).toBe('');
    expect(w2?.repoRoot).toBe('/tmp/projW2');
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

// Runs after the listSessions suite, so it builds on its p1/p2 family fixture.
describe('sibling grouping across refreshes', () => {
  it('extends the family when a new branch joins, and unmarks it when one leaves', async () => {
    // p3 joins the p1/p2 family: same first-message uuid, its own extra message.
    const p3File = path.join(projectsDir, '-tmp-proj', 'p3.jsonl');
    await fs.writeFile(
      p3File,
      jsonl(
        { type: 'user', uuid: 'uf', cwd: '/tmp/projF', message: { content: 'orig' } },
        { type: 'assistant', uuid: 'af1', message: { content: 'r1' } },
        { type: 'assistant', uuid: 'af3', message: { content: 'r3 (another fork)' } },
      ),
    );
    let p1 = (await listSessions()).find((s) => s.id === 'p1');
    expect(p1?.siblingIds?.slice().sort()).toEqual(['p2', 'p3']);

    // p3 leaves again: cached summaries must lose the stale mark, not keep it.
    await fs.rm(p3File);
    p1 = (await listSessions()).find((s) => s.id === 'p1');
    expect(p1?.isSibling).toBe(true);
    expect(p1?.siblingIds).toEqual(['p2']);
  });
});
