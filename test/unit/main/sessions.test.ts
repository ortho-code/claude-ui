import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, promises as fs, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// A temp HOME whose ~/.claude/projects we fill with fixtures.
// Created in vi.hoisted so it exists before the node:os mock factory (which closes over it) and before sessions.ts loads.
const { testHome, logged } = vi.hoisted(() => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  return { testHome: fs.mkdtempSync(path.join(os.tmpdir(), 'claude-ui-sess-')) as string, logged: [] as string[] };
});

vi.mock('electron', () => ({ shell: { trashItem: vi.fn() } }));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => testHome };
});

import { findTranscript, listSessions } from '../../../src/main/sessions';
import type { SessionCheckout } from '../../../src/shared/types';

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

  // Real compaction: after a structured system/compact_boundary event, the next user/assistant uuid is captured as the post-compaction head.
  await fs.writeFile(
    path.join(dir, 'k.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uk', cwd: '/tmp/projK', message: { content: 'start' } },
      { type: 'system', subtype: 'compact_boundary', uuid: 'kb', compactMetadata: { trigger: 'manual' } },
      { type: 'assistant', uuid: 'khead', message: { content: 'after compaction' } },
    ),
  );

  // Case A: a fork of a COMPACTED session adopts a post-compaction head as its conversationId.
  // q's first message uuid equals k's post-compaction head 'khead', so k and q are one family.
  // The fork copies the parent's boundary event too, so q also claims 'khead' as its OWN head (the real c74279cd shape) — that self-claim must not break the k<->q link.
  await fs.writeFile(
    path.join(dir, 'q.jsonl'),
    jsonl(
      { type: 'system', subtype: 'compact_boundary', uuid: 'qb', compactMetadata: { trigger: 'manual' } },
      { type: 'user', uuid: 'khead', cwd: '/tmp/projK', message: { content: 'fork of compacted' } },
      { type: 'assistant', uuid: 'aq', message: { content: 'carries on' } },
    ),
  );

  // False positive guard: the words appear only in message TEXT, with no real boundary event -> no post-compaction head is captured (the old substring check wrongly flagged this).
  await fs.writeFile(
    path.join(dir, 'm.jsonl'),
    jsonl(
      { type: 'user', uuid: 'um', cwd: '/tmp/projM', message: { content: 'why does compactMetadata match' } },
      { type: 'assistant', uuid: 'am', message: { content: 'we changed the compact_boundary detection' } },
    ),
  );

  // Mid-life worktree entry (claude's EnterWorktree tool): the transcript stays in the original project dir; the last worktree-state event decides where the session lives.
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
  // First cwd in the worktree, and left it on its last line: the real 7e47c698 shape, which carries over another session's worktree entry, all 44 of its enters naming the main checkout as their original cwd.
  await fs.writeFile(
    path.join(dir, 'w3.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw3', cwd: `${testHome}/.claude/worktrees/wtg3`, message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW3', worktreePath: `${testHome}/.claude/worktrees/wtg3`, worktreeName: 'wtg3', hookBased: true } },
      { type: 'relocated', relocatedCwd: '/tmp/projW3' },
      { type: 'worktree-state', worktreeSession: null },
    ),
  );
  // Left a worktree, then entered one again: in a worktree now, and nothing to say about the one it left.
  await fs.writeFile(
    path.join(dir, 'w4.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw4', cwd: '/tmp/projW4', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW4', worktreePath: `${testHome}/.claude/worktrees/wtg4a`, worktreeName: 'wtg4a', hookBased: true } },
      { type: 'worktree-state', worktreeSession: null },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW4', worktreePath: `${testHome}/.claude/worktrees/wtg4b`, worktreeName: 'wtg4b', hookBased: true } },
    ),
  );
  // Moved out by claude's ExitWorktree tool mid-session, its call two records after the exit, a thinking-only record between, and the work going on: the real abbb2b3e shape.
  const exitCall = (uuid: string): Record<string, unknown> => ({ type: 'assistant', uuid, message: { content: [{ type: 'tool_use', id: `t-${uuid}`, name: 'ExitWorktree', input: { action: 'keep' } }] } });
  await fs.writeFile(
    path.join(dir, 'w6.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw6', cwd: '/tmp/projW6', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW6', worktreePath: `${testHome}/.claude/worktrees/wtg6`, worktreeName: 'wtg6', hookBased: true } },
      { type: 'relocated', relocatedCwd: '/tmp/projW6' },
      { type: 'worktree-state', worktreeSession: null },
      { type: 'assistant', uuid: 'aw6t', message: { content: [{ type: 'thinking', thinking: '' }] } },
      exitCall('aw6'),
      { type: 'user', uuid: 'uw6b', cwd: '/tmp/projW6', message: { content: 'carry on here' } },
    ),
  );
  // Closed in its worktree, resumed, and asked to leave it then: Claude Code refuses a worktree from an earlier session, so nothing moved, and a call after a later prompt is not the exit's.
  await fs.writeFile(
    path.join(dir, 'w9.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw9', cwd: '/tmp/projW9', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW9', worktreePath: `${testHome}/.claude/worktrees/wtg9`, worktreeName: 'wtg9', hookBased: true } },
      { type: 'relocated', relocatedCwd: '/tmp/projW9' },
      { type: 'worktree-state', worktreeSession: null },
      { type: 'user', uuid: 'uw9b', cwd: '/tmp/projW9', message: { content: 'resumed: leave the worktree' } },
      exitCall('aw9'),
    ),
  );
  // The same move with the call before the exit, should Claude Code write them the other way round.
  await fs.writeFile(
    path.join(dir, 'w7.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw7', cwd: '/tmp/projW7', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW7', worktreePath: `${testHome}/.claude/worktrees/wtg7`, worktreeName: 'wtg7', hookBased: true } },
      exitCall('aw7'),
      { type: 'worktree-state', worktreeSession: null },
    ),
  );
  // Closed in its worktree, which Claude Code also writes as an exit, then resumed later: work after the exit, and no call.
  await fs.writeFile(
    path.join(dir, 'w8.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw8', cwd: '/tmp/projW8', message: { content: 'work' } },
      { type: 'worktree-state', worktreeSession: { originalCwd: '/tmp/projW8', worktreePath: `${testHome}/.claude/worktrees/wtg8`, worktreeName: 'wtg8', hookBased: true } },
      { type: 'relocated', relocatedCwd: '/tmp/projW8' },
      { type: 'worktree-state', worktreeSession: null },
      { type: 'worktree-state', worktreeSession: null },
      { type: 'user', uuid: 'uw8b', cwd: '/tmp/projW8', message: { content: 'resumed days later' } },
    ),
  );
  // A Bash `cd` into a worktree moves the cwd the records carry and nothing else: no worktree-state, the transcript where it was, a resume in the main checkout.
  await fs.writeFile(
    path.join(dir, 'w5.jsonl'),
    jsonl(
      { type: 'user', uuid: 'uw5', cwd: '/tmp/projW5', message: { content: 'work' } },
      { type: 'user', uuid: 'uw5b', cwd: `${testHome}/.claude/worktrees/wtg5`, message: { content: 'more work' } },
    ),
  );

  // Slash-command starts: the first message is wrapped in command tags; the row should show the command line the user effectively typed, without its slash, not the tag soup.
  // Real shapes: with args, and with an empty args tag.
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

  // A session that starts with a command claude runs itself: its caveat, the command, and its output are not a prompt, so the first message is the first prompt after them.
  // The caveat event still anchors the conversationId (identity must not move).
  // The shape claude 2.1.302 writes: the command `<command-name>` first, hanging off the caveat.
  await fs.writeFile(
    path.join(dir, 'sc3.jsonl'),
    jsonl(
      { type: 'user', uuid: 'ucv', isMeta: true, cwd: '/tmp/projSC', message: { content: '<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user.</local-command-caveat>' } },
      { type: 'user', uuid: 'ucm', parentUuid: 'ucv', cwd: '/tmp/projSC', message: { content: '<command-name>/model</command-name>\n            <command-message>model</command-message>\n            <command-args>opus</command-args>' } },
      { type: 'user', uuid: 'ust', parentUuid: 'ucm', cwd: '/tmp/projSC', message: { content: '<local-command-stdout>Set model to Opus 5</local-command-stdout>' } },
      { type: 'user', uuid: 'upr', parentUuid: 'ust', cwd: '/tmp/projSC', message: { content: 'why is the build slow?' } },
    ),
  );

  // A session `/clear` started in a named one, renamed before anything was typed: claude copies the name to the top, and writes the `/clear`, the `/rename` and the reminder about it, none of them a prompt (shapes from claude 2.1.302).
  await fs.writeFile(
    path.join(dir, 'cl1.jsonl'),
    jsonl(
      { type: 'custom-title', customTitle: 'Claude setup', sessionId: 'cl1' },
      { type: 'user', uuid: 'clv', isMeta: true, cwd: '/tmp/projSC', message: { content: '<local-command-caveat>The command below was run directly in Claude Code, not sent to you as a request, and its output goes straight to the user.</local-command-caveat>' } },
      { type: 'user', uuid: 'clc', parentUuid: 'clv', cwd: '/tmp/projSC', message: { content: '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>' } },
      { type: 'system', subtype: 'local_command', uuid: 'cls', parentUuid: 'clc', content: '<local-command-stdout></local-command-stdout>' },
      { type: 'custom-title', customTitle: 'hook rules', sessionId: 'cl1' },
      { type: 'system', subtype: 'local_command', uuid: 'clr', parentUuid: 'cls', content: '<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>hook rules</command-args>' },
      { type: 'user', uuid: 'clm', parentUuid: 'clr', isMeta: true, cwd: '/tmp/projSC', message: { content: '<system-reminder>\nThe user named this session "hook rules". This may indicate the session\'s focus or intent.\n</system-reminder>' } },
    ),
  );

  // The PRs a transcript links: Claude Code writes the same record again through a session, a second PR after a first, and the reader keeps a record it can use.
  // Every record sits after the first message, where the reader no longer parses an ordinary line.
  const link = (prNumber: unknown, prRepository: unknown = 'ScientaNL/demo', prUrl: unknown = `https://github.com/ScientaNL/demo/pull/${String(prNumber)}`) => ({ type: 'pr-link', sessionId: 'pr', prNumber, prRepository, prUrl, timestamp: '2026-01-01T00:00:00.000Z' });
  await fs.writeFile(
    path.join(dir, 'pr.jsonl'),
    jsonl(
      { type: 'user', uuid: 'upr', cwd: '/tmp/projPR', message: { content: 'open a PR' } },
      { type: 'assistant', uuid: 'apr', message: { content: 'opened' } },
      link(12),
      link(12),
      link(7),
      // Records the reader cannot use, each skipped.
      link('5'),
      link(0),
      link(3.5),
      link(9, ''),
      link(9, 'ScientaNL/demo', 'javascript:alert(1)'),
      link(9, 'ScientaNL/demo', 42),
    ),
  );

  // lastActivity comes from the last MESSAGE, so a later system event (a background/Remote Control touch) must not push it forward.
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

  it('reads the PRs a transcript links, each once, in the order first linked, and skips a record it cannot use', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'pr')?.prs).toEqual([
      { repository: 'ScientaNL/demo', number: 12, url: 'https://github.com/ScientaNL/demo/pull/12' },
      { repository: 'ScientaNL/demo', number: 7, url: 'https://github.com/ScientaNL/demo/pull/7' },
    ]);
    expect(sessions.find((s) => s.id === 'a')?.prs).toEqual([]);
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

  it('renders a slash-command first message as the typed command line, without its slash', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'sc1')?.firstMessage).toBe('research SC-51053 and the big plan');
    expect(sessions.find((s) => s.id === 'sc2')?.firstMessage).toBe('compact'); // empty args tag
  });

  it('skips a command claude runs itself when picking the first message, without moving identity', async () => {
    const sc3 = (await listSessions()).find((s) => s.id === 'sc3');
    expect(sc3?.firstMessage).toBe('why is the build slow?');
    expect(sc3?.conversationId).toBe('ucv'); // still anchored on the first user event
  });

  it('gives a cleared session no first message until something is typed in it, and keeps the name claude gave it', async () => {
    const cl1 = (await listSessions()).find((s) => s.id === 'cl1');
    expect(cl1?.firstMessage).toBe('');
    expect(cl1?.title).toBe('hook rules');
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

  it('drops a session back to its original cwd after it exited the worktree, and keeps the worktree it left', async () => {
    const w2 = (await listSessions()).find((s) => s.id === 'w2');
    expect(w2?.cwd).toBe('/tmp/projW2');
    expect(w2?.worktree).toBe('');
    expect(w2?.leftWorktree).toBe('wtg2');
    expect(w2?.repoRoot).toBe('/tmp/projW2');
  });

  it('keeps the worktree a session left, even one whose first cwd was in it', async () => {
    const w3 = (await listSessions()).find((s) => s.id === 'w3');
    expect(w3?.cwd).toBe('/tmp/projW3');
    expect(w3?.repoRoot).toBe('/tmp/projW3');
    expect(w3?.worktree).toBe('');
    expect(w3?.leftWorktree).toBe('wtg3');
  });

  it('tells a session moved out of its worktree by the ExitWorktree tool from one closed in it, the call before or after the exit', async () => {
    const sessions = await listSessions();
    const left = (id: string): [string | undefined, boolean | undefined] => {
      const s = sessions.find((x) => x.id === id);
      return [s?.leftWorktree, s?.movedOutOfWorktree];
    };
    expect(left('w6')).toEqual(['wtg6', true]);
    expect(left('w7')).toEqual(['wtg7', true]);
    // Closed there: at the end of the file, or resumed after it.
    expect(left('w3')).toEqual(['wtg3', false]);
    expect(left('w8')).toEqual(['wtg8', false]);
    // A call after a later prompt is not the exit's.
    expect(left('w9')).toEqual(['wtg9', false]);
    // Never left one.
    expect(left('w1')).toEqual(['', false]);
  });

  it('says nothing about a worktree left behind once the session is in one again', async () => {
    const w4 = (await listSessions()).find((s) => s.id === 'w4');
    expect(w4?.worktree).toBe('wtg4b');
    expect(w4?.leftWorktree).toBe('');
  });

  it('counts no worktree for a session that only moved into one with a cd', async () => {
    const w5 = (await listSessions()).find((s) => s.id === 'w5');
    expect(w5?.cwd).toBe('/tmp/projW5');
    expect(w5?.worktree).toBe('');
    expect(w5?.leftWorktree).toBe('');
  });

  it('has no worktree left behind for a session still in one, or never in one', async () => {
    const sessions = await listSessions();
    expect(sessions.find((s) => s.id === 'w1')?.leftWorktree).toBe('');
    expect(sessions.find((s) => s.id === 'a')?.leftWorktree).toBe('');
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

// The folder a session works in, which a panel without a `cwd` of its own runs in: the checkout of the newest file claude changed with a file tool.
// Against a real repository with linked worktrees in the temp folder, since which checkout a file is in, and whether git ignores it there, are git's own answers.
describe('the folder a session works in', () => {
  // The person's git config is kept out, the global and the system one and the global excludes file, which would add their own ignores (`~/.config/git/ignore`) to the test repository's.
  const saved: Record<string, string | undefined> = {};
  let repo = '';
  let outside = '';
  let config = '';
  let second = 0;

  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-C', repo, ...args], { stdio: 'ignore' });
  };
  const worktree = (name: string): string => path.join(repo, '.claude', 'worktrees', name);
  const at = (): string => new Date(Date.UTC(2026, 9, 26, 10, 0, second++)).toISOString();
  const change = (file: string, name = 'Edit'): Record<string, unknown> => ({
    type: 'assistant',
    uuid: `work-a${second}`,
    cwd: repo,
    timestamp: at(),
    message: { content: [{ type: 'tool_use', id: `work-t${second}`, name, input: name === 'NotebookEdit' ? { notebook_path: file, new_source: '' } : { file_path: file } }] },
  });
  const enter = (name: string): Record<string, unknown> => ({ type: 'worktree-state', worktreeSession: { originalCwd: repo, worktreePath: worktree(name), worktreeName: name, hookBased: false } });
  const exit = { type: 'worktree-state', worktreeSession: null };
  const sessionIn = (id: string, cwd: string, ...events: unknown[]): Promise<void> =>
    fs.writeFile(path.join(projectsDir, '-work', `${id}.jsonl`), jsonl({ type: 'user', uuid: `work-u-${id}`, cwd, timestamp: at(), message: { content: 'work' } }, ...events));
  const session = (id: string, ...events: unknown[]): Promise<void> => sessionIn(id, repo, ...events);
  const workCwd = async (id: string): Promise<string | undefined> => (await listSessions()).find((s) => s.id === id)?.workCwd;
  const listed = async (id: string): Promise<SessionCheckout[] | undefined> => (await listSessions()).find((s) => s.id === id)?.checkouts;
  // The time each change below was made, by name, for the lists that carry it.
  const stamps: Record<string, string> = {};
  const stamped = (name: string, event: Record<string, unknown>): Record<string, unknown> => {
    stamps[name] = event.timestamp as string;
    return event;
  };

  beforeAll(async () => {
    config = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-config-'));
    for (const [name, value] of Object.entries({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: config })) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-')));
    git('init', '-q');
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n/.claude/worktrees\n');
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'a.txt'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    for (const name of ['wt-a', 'wt-b', 'wt-c', 'wt-d', 'wt-gone']) git('worktree', 'add', '-q', '-b', name, worktree(name));
    // Removed by hand, so git still lists it, as prunable.
    rmSync(worktree('wt-gone'), { recursive: true, force: true });
    // A folder git does not know as a worktree, as one left behind looks.
    mkdirSync(path.join(worktree('wt-left'), 'src'), { recursive: true });
    // A link out of the repository, as a folder of notes kept elsewhere is linked into a checkout.
    outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-outside-')));
    symlinkSync(outside, path.join(repo, 'plans'));

    await fs.mkdir(path.join(projectsDir, '-work'), { recursive: true });
    const inA = path.join(worktree('wt-a'), 'src', 'a.txt');
    const inB = path.join(worktree('wt-b'), 'src', 'a.txt');
    // b11ed876's week: its worktree left, as the record claude writes for an exit says, then the work going on in it by path.
    const week = [enter('wt-a'), change(inA), exit, change(inA, 'MultiEdit')];
    await session('work-week', ...week);
    await session('work-ignored', ...week, change(path.join(repo, 'ignored.txt')));
    await session('work-outside', ...week, change(path.join(outside, 'plan.md'), 'Write'), change(path.join(repo, 'plans', 'plan.md')));
    await session('work-tracked', ...week, change(path.join(repo, 'src', 'a.txt')));
    await session('work-own', change(path.join(repo, 'src', 'a.txt')));
    await session('work-entered', change(inA), enter('wt-b'));
    // Claude Code writes an entered state again with each turn while the session is in its worktree.
    await session('work-repeat', enter('wt-a'), change(path.join(repo, 'src', 'a.txt')), enter('wt-a'));
    await session('work-blob', { type: 'api-request-blob', hash: 'h', message: { content: [{ type: 'tool_use', id: 'work-blob-t', name: 'Edit', input: { file_path: inA } }] } });
    await session('work-none', { type: 'assistant', uuid: 'work-none-a', timestamp: at(), message: { content: 'nothing changed' } });
    await session('work-notebook', change(path.join(worktree('wt-b'), 'n.ipynb'), 'NotebookEdit'));
    await session('work-gone', change(inB, 'Write'), change(path.join(worktree('wt-gone'), 'src', 'a.txt')));
    await session('work-left', change(inB), change(path.join(worktree('wt-left'), 'src', 'a.txt')));
    await session('work-removed', change(path.join(worktree('wt-c'), 'src', 'a.txt')));
    // The checkouts a session's worktree mark lists.
    const inMain = path.join(repo, 'src', 'a.txt');
    await session('list-two', stamped('two-a', change(inA)), stamped('two-b', change(inB)));
    await sessionIn('list-own', worktree('wt-a'), stamped('own-main', change(inMain)), stamped('own-b', change(inB)));
    await session('list-left-main', enter('wt-b'), exit, stamped('left-main', change(inMain)));
    await sessionIn('list-left-folder', worktree('wt-left'), change(path.join(worktree('wt-left'), 'src', 'a.txt')));
    await session('list-removed', change(path.join(worktree('wt-d'), 'src', 'a.txt')), change(inA));
    // Its paths reach a worktree, so it is not passed over before git is asked, but git ignores the file it changed there.
    await session('list-ignored-elsewhere', change(inMain), change(path.join(worktree('wt-a'), 'ignored.txt')));
    // A session in a worktree of a repository deleted since, which claude's `.claude/worktrees/` layout still files under that repository.
    const gone = `${repo}-deleted`;
    await fs.writeFile(
      path.join(projectsDir, '-work', 'work-repo-gone.jsonl'),
      jsonl({ type: 'user', uuid: 'work-u-repo-gone', cwd: path.join(gone, '.claude', 'worktrees', 'wt'), timestamp: at(), message: { content: 'work' } }, change(path.join(gone, 'src', 'a.txt'))),
    );
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const dir of [repo, outside, config]) rmSync(dir, { recursive: true, force: true });
  });

  it('follows a session into the worktree it changes files in by path after leaving it, and moves nothing else', async () => {
    const week = (await listSessions()).find((s) => s.id === 'work-week');
    expect(week?.workCwd).toBe(worktree('wt-a'));
    expect([week?.cwd, week?.worktree, week?.leftWorktree]).toEqual([repo, '', 'wt-a']);
  });

  it('passes over a file git ignores, one outside the repository, and one behind a link out of it', async () => {
    expect(await workCwd('work-ignored')).toBe(worktree('wt-a'));
    expect(await workCwd('work-outside')).toBe(worktree('wt-a'));
  });

  it('is the folder the session runs in once it changes a tracked file in that checkout', async () => {
    expect(await workCwd('work-tracked')).toBe('');
    expect(await workCwd('work-own')).toBe('');
  });

  it('gives way to a worktree entered after the last change, but not to an entry repeated', async () => {
    expect(await workCwd('work-entered')).toBe('');
    expect(await workCwd('work-repeat')).toBe(repo);
  });

  it("counts the file tools in claude's own messages, each of them, and not in a request replayed", async () => {
    expect(await workCwd('work-notebook')).toBe(worktree('wt-b'));
    expect(await workCwd('work-blob')).toBe('');
    expect(await workCwd('work-none')).toBe('');
  });

  it('is the folder the session runs in, not an older checkout, when its newest change is in a worktree that is gone', async () => {
    expect(await workCwd('work-gone')).toBe('');
    expect(await workCwd('work-left')).toBe('');
  });

  it('asks git nothing about a repository that is gone, and is the folder the session runs in', async () => {
    expect(await workCwd('work-repo-gone')).toBe('');
    expect(logged.filter((line) => line.includes('checkouts'))).toEqual([]);
  });

  it('is the folder the session runs in once the checkout it found is removed', async () => {
    expect(await workCwd('work-removed')).toBe(worktree('wt-c'));
    rmSync(worktree('wt-c'), { recursive: true, force: true });
    expect(await workCwd('work-removed')).toBe('');
  });

  it('lists every checkout a session changed a file in, newest first, each at its newest change there', async () => {
    expect(await listed('list-two')).toEqual([
      { root: worktree('wt-b'), at: stamps['two-b'], gone: false, own: false },
      { root: worktree('wt-a'), at: stamps['two-a'], gone: false, own: false },
    ]);
  });

  it('lists the worktree its badge names, where it runs or that it left, and the main checkout only for a change git shows', async () => {
    expect(await listed('list-own')).toEqual([
      { root: worktree('wt-b'), at: stamps['own-b'], gone: false, own: false },
      { root: repo, at: stamps['own-main'], gone: false, own: false },
      { root: worktree('wt-a'), at: '', gone: false, own: true },
    ]);
    expect(await listed('list-left-main')).toEqual([
      { root: repo, at: stamps['left-main'], gone: false, own: false },
      { root: worktree('wt-b'), at: '', gone: false, own: true },
    ]);
    expect((await listed('work-tracked'))?.map(({ root, own }) => [root, own])).toEqual([[repo, false], [worktree('wt-a'), true]]);
    expect(await listed('work-ignored')).toEqual([]);
  });

  it('lists nothing when there is nothing besides the worktree its badge names, or without a badge the checkout it runs in', async () => {
    expect(await listed('work-week')).toEqual([]);
    expect(await listed('list-left-folder')).toEqual([]);
    expect(await listed('work-own')).toEqual([]);
    expect(await listed('work-none')).toEqual([]);
    expect(await listed('list-ignored-elsewhere')).toEqual([]);
  });

  it('says a checkout removed since the transcript was read is gone, at the next listing', async () => {
    const roots = async (): Promise<[string, boolean][] | undefined> => (await listed('list-removed'))?.map(({ root, gone }) => [root, gone]);
    expect(await roots()).toEqual([[worktree('wt-a'), false], [worktree('wt-d'), false]]);
    rmSync(worktree('wt-d'), { recursive: true, force: true });
    expect(await roots()).toEqual([[worktree('wt-a'), false], [worktree('wt-d'), true]]);
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
    expect(p1?.siblingIds.slice().sort()).toEqual(['p2', 'p3']);

    // p3 leaves again: cached summaries must lose the stale mark, not keep it.
    await fs.rm(p3File);
    p1 = (await listSessions()).find((s) => s.id === 'p1');
    expect(p1?.isSibling).toBe(true);
    expect(p1?.siblingIds).toEqual(['p2']);
  });
});

describe('findTranscript', () => {
  it('finds a listed session by its id', async () => {
    await listSessions();
    expect(await findTranscript('a')).toBe(path.join(projectsDir, '-tmp-proj', 'a.jsonl'));
  });

  it('finds one the last listing has not seen yet', async () => {
    const dir = path.join(projectsDir, '-tmp-late');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'late.jsonl'), jsonl({ type: 'user', uuid: 'ul', cwd: '/tmp/late', message: { content: 'hi' } }));
    expect(await findTranscript('late')).toBe(path.join(dir, 'late.jsonl'));
  });

  it('answers null for no such session, and for anything that is not an id', async () => {
    expect(await findTranscript('nope')).toBeNull();
    expect(await findTranscript('../-tmp-proj/a')).toBeNull();
    expect(await findTranscript('')).toBeNull();
  });
});
