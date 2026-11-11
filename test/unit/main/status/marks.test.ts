import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { auditLines, metaDir, useMetaDir, writeMetaFile } from '../sessions/meta-fixture';

vi.mock('electron', async () => (await import('../sessions/meta-fixture')).electronStub);

import { clearNeedsYou, clearSetAside, getKept, getNeedsYou, getNeedsYouHistory, getSetAside, keep, markNeedsYou, markSetAside, restoreNeedsYou, setAsideCameDue, unkeep } from '../../../../src/main/status/marks';
import { finish, getRunningSessions, purgeSession, setOpenSessions, togglePin } from '../../../../src/main/sessions/meta';

useMetaDir();

describe('sessions that need you', () => {
  it('are marked with every reason and since when, one of a kind replacing the last, and taken off one session at a time', async () => {
    expect(await getNeedsYou()).toEqual({});
    await markNeedsYou(['a', 'b'], [{ type: 'app.was-running', at: 1, how: 'ended' }]);
    await markNeedsYou(['a'], [{ type: 'app.reminder', at: 2 }]);
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 3, how: 'quit' }]);
    expect(await getNeedsYou()).toEqual({
      a: [
        { type: 'app.reminder', at: 2 },
        { type: 'app.was-running', at: 3, how: 'quit' },
      ],
      b: [{ type: 'app.was-running', at: 1, how: 'ended' }],
    });
    await clearNeedsYou('a', 'cleared');
    expect(Object.keys(await getNeedsYou())).toEqual(['b']);
  });

  // Kept per session, not per tab: a mark outlives the tabs being written again, as every launch writes them.
  it('stay through the open tabs being written', async () => {
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 1, how: 'quit' }]);
    await setOpenSessions(['b'], []);
    expect(Object.keys(await getNeedsYou())).toEqual(['a']);
  });

  it('are taken off by a finish, and forgotten by a delete', async () => {
    await markNeedsYou(['a', 'b'], [{ type: 'app.was-running', at: 1, how: 'quit' }]);
    await finish(['a']);
    await purgeSession('b');
    expect(await getNeedsYou()).toEqual({});
  });

  it('are none in a file written before they were kept, and a reason this build does not fire or without what it needs is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getNeedsYou()).toEqual({});
    await writeMetaFile({
      version: 3,
      needsYou: {
        a: [{ type: 'app.was-running', at: 5, how: 'quit' }],
        b: [{ type: 'claude.asks', at: 5 }],
        c: [{ type: 'app.reminder' }],
        d: 'yes',
        e: [
          { type: 'app.reminder', at: 7 },
          { type: 'nonsense', at: 8 },
          { type: 'app.was-running', at: 8, how: 'sometime' },
          { type: 'pr.merged', at: 8 },
        ],
        f: [{ type: 'pr.checks-failed', at: 9, pr: 'acme/app#7' }],
      },
    });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }], e: [{ type: 'app.reminder', at: 7 }], f: [{ type: 'pr.checks-failed', at: 9, pr: 'acme/app#7' }] });
  });

  // Before reasons had types (decided 2026-11-06): how the app closed was the reason itself, and a PR's changes one reason holding them all.
  it('read the form from before reasons had types, a PR reason as a reason per change, and drop one this build cannot read', async () => {
    await writeMetaFile({
      version: 3,
      needsYou: {
        a: [{ reason: 'ended', at: 1 }, { reason: 'reminder', at: 2 }, { reason: 'pr', at: 5, pr: 'acme/app#7', changes: ['checks failed', 'approved'] }],
        b: [{ reason: 'pr', at: 5, changes: ['merged'] }],
        c: [{ reason: 'pr', at: 5, pr: 'acme/app#7', changes: ['merged', 'nonsense'] }],
        d: [{ reason: 'pr', at: 5, pr: 'acme/app#7', changes: [] }],
        e: [{ reason: 'nonsense', at: 5 }, { reason: 'ended' }],
      },
    });
    expect(await getNeedsYou()).toEqual({
      a: [
        { type: 'app.was-running', at: 1, how: 'ended' },
        { type: 'app.reminder', at: 2 },
        { type: 'pr.checks-failed', at: 5, pr: 'acme/app#7' },
        { type: 'pr.approved', at: 5, pr: 'acme/app#7' },
      ],
    });
  });

  // A file from before a session kept every reason holds one reason per session.
  it('read a single reason, as an older file holds it, as a list of one', async () => {
    await writeMetaFile({ version: 3, needsYou: { a: { reason: 'quit', at: 5 }, b: { reason: 'nonsense', at: 5 } } });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }] });
  });

  it('keep what settled each reason, by what and when, in the same write that takes it off, and put back by Undo leave none', async () => {
    const quit = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
    await markNeedsYou(['a', 'b'], [quit]);
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 2, how: 'ended' }]);
    await clearNeedsYou('a', 'prompt');
    await finish(['b']);
    const history = await getNeedsYouHistory();
    expect(history).toEqual({
      a: [
        { type: 'app.was-running', at: 2, how: 'ended', settled: expect.any(Number), by: 'prompt' },
        { ...quit, settled: expect.any(Number), by: 'replaced' },
      ],
      b: [{ ...quit, settled: expect.any(Number), by: 'finished' }],
    });
    await restoreNeedsYou('b', [quit]);
    expect(await getNeedsYou()).toEqual({ b: [quit] });
    expect(Object.keys(await getNeedsYouHistory())).toEqual(['a']);
    await purgeSession('a');
    expect(await getNeedsYouHistory()).toEqual({});
  });

  it('read a history entry only with a reason, the moment it was settled and what settled it, and keep the newest twenty', async () => {
    const entry = (at: number, more: object = {}) => ({ type: 'app.reminder', at, settled: at, by: 'cleared', ...more });
    await writeMetaFile({
      version: 3,
      needsYouHistory: { a: [entry(1), entry(2, { by: 'nonsense' }), entry(3, { settled: 'then' }), entry(4, { type: 'nonsense' })], b: 'yes', c: Array.from({ length: 25 }, (_, i) => entry(i)) },
    });
    const history = await getNeedsYouHistory();
    expect(history.a).toEqual([{ type: 'app.reminder', at: 1, settled: 1, by: 'cleared' }]);
    expect(Object.keys(history).sort()).toEqual(['a', 'c']);
    expect(history.c).toHaveLength(20);
  });

  // A key a build does not know goes through `extra` untouched, which is how a build from before the history keeps it, so going back a build and forward again loses none of it.
  it('stay in the file through a write, and so does a key the build does not know', async () => {
    const raw = { version: 3, needsYouHistory: { a: [{ type: 'app.reminder', at: 1, settled: 2, by: 'cleared' }] }, someLaterKey: { x: 1 } };
    await writeMetaFile(raw);
    await togglePin('z');
    const written = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(written.needsYouHistory).toEqual(raw.needsYouHistory);
    expect(written.someLaterKey).toEqual({ x: 1 });
  });

  // The reader of the build before reasons had types, as it was: what a build gone back to reads of what this one wrote.
  const olderReader = (raw: Record<string, unknown[]>): Record<string, unknown[]> =>
    Object.fromEntries(
      Object.entries(raw).flatMap(([id, entry]) => {
        const reasons = entry.flatMap((item) => {
          const { reason, at, pr, changes } = item as Record<string, unknown>;
          if (!['quit', 'ended', 'unknown', 'reminder', 'pr'].includes(reason as string) || typeof at !== 'number') return [];
          if (reason !== 'pr') return [{ reason, at }];
          const known = Array.isArray(changes) && changes.length > 0 && changes.every((change) => ['checks failed', 'merge conflict', 'changes requested', 'merged', 'closed', 'approved', 'reopened'].includes(change as string));
          return typeof pr === 'string' && known ? [{ reason, at, pr, changes }] : [];
        });
        return reasons.length > 0 ? [[id, reasons]] : [];
      }),
    );

  it('are written so that a build from before reasons had types reads every one, and what it writes back reads as the same reasons', async () => {
    const reasons = [
      { type: 'app.was-running' as const, at: 1, how: 'unknown' as const },
      { type: 'app.reminder' as const, at: 2 },
      { type: 'pr.checks-failed' as const, at: 3, pr: 'acme/app#7' },
      { type: 'pr.approved' as const, at: 3, pr: 'acme/app#7' },
      { type: 'pr.reopened' as const, at: 4, pr: 'acme/app#8' },
    ];
    await markNeedsYou(['a'], reasons);
    const older = olderReader(JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8')).needsYou);
    expect(older).toEqual({
      a: [
        { reason: 'unknown', at: 1 },
        { reason: 'reminder', at: 2 },
        { reason: 'pr', at: 3, pr: 'acme/app#7', changes: ['checks failed'] },
        { reason: 'pr', at: 3, pr: 'acme/app#7', changes: ['approved'] },
        { reason: 'pr', at: 4, pr: 'acme/app#8', changes: ['reopened'] },
      ],
    });
    await writeMetaFile({ version: 3, needsYou: older });
    expect(await getNeedsYou()).toEqual({ a: reasons });
  });
});

describe('the keep stamps', () => {
  it('stamp several sessions in one write, are taken off, stay through a finish and go with a delete', async () => {
    const before = await auditLines();
    await keep(['a', 'b'], 5);
    expect(await getKept()).toEqual({ a: 5, b: 5 });
    await unkeep(['b']);
    expect(await getKept()).toEqual({ a: 5 });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['keep', 'unkeep']);
    await finish(['a']);
    expect(await getKept()).toEqual({ a: 5 });
    await purgeSession('a');
    expect(await getKept()).toEqual({});
  });

  it('are none in a file written before they were kept, and a stamp that is no moment is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getKept()).toEqual({});
    await writeMetaFile({ version: 3, kept: { a: 5, b: 'monday', c: null } });
    expect(await getKept()).toEqual({ a: 5 });
  });
});

describe('the later marks', () => {
  it('are kept per session from the time given, replaced by a new one, and taken off', async () => {
    await markSetAside(['a'], null, 5);
    await markSetAside(['b'], 100, 5);
    await markSetAside(['b'], 200, 6);
    expect(await getSetAside()).toEqual({ a: { due: null, at: 5 }, b: { due: 200, at: 6 } });
    await clearSetAside(['a']);
    expect(await getSetAside()).toEqual({ b: { due: 200, at: 6 } });
  });

  it('are marked and taken off for several sessions in one write each', async () => {
    const before = await auditLines();
    await markSetAside(['a', 'b', 'c'], 100, 5);
    expect(await getSetAside()).toEqual({ a: { due: 100, at: 5 }, b: { due: 100, at: 5 }, c: { due: 100, at: 5 } });
    await clearSetAside(['a', 'c']);
    expect(await getSetAside()).toEqual({ b: { due: 100, at: 5 } });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['markSetAside', 'clearSetAside']);
  });

  it('stay through the open tabs being written, are taken off by a finish, and forgotten by a delete', async () => {
    await markSetAside(['a'], null);
    await markSetAside(['b'], null);
    await setOpenSessions([], []);
    expect(Object.keys(await getSetAside())).toEqual(['a', 'b']);
    await finish(['a']);
    await purgeSession('b');
    expect(await getSetAside()).toEqual({});
  });

  it('come due as needing you, keeping a reason the session already had', async () => {
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 5, how: 'quit' }]);
    await markSetAside(['a', 'b'], 100, 10);
    await markSetAside(['c'], 300, 10);
    await setAsideCameDue(150);
    expect(await getSetAside()).toEqual({ c: { due: 300, at: 10 } });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }], b: [{ type: 'app.reminder', at: 100 }] });
  });

  it('are none in a file written before they were kept, and an entry without a time or with a day that is not one is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getSetAside()).toEqual({});
    await writeMetaFile({ version: 3, setAside: { a: { due: null, at: 5 }, b: { due: 9, at: 5 }, c: { due: 'monday', at: 5 }, d: { due: null }, e: 'yes' } });
    expect(await getSetAside()).toEqual({ a: { due: null, at: 5 }, b: { due: 9, at: 5 } });
  });

  // Pause gave way to the set-aside mark, so nothing a file from before set aside is lost.
  it('take in the tabs a file from before paused, whenever, keeping a mark one already has, and the next write drops the paused list', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a', 'b'], pausedSessions: ['a', 'b', 7], setAside: { b: { due: 9, at: 5 } } });
    expect(await getSetAside()).toEqual({ a: { due: null, at: expect.any(Number) }, b: { due: 9, at: 5 } });
    await setOpenSessions(['a', 'b'], []);
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.pausedSessions).toBeUndefined();
    expect(raw.setAside).toEqual({ a: { due: null, at: expect.any(Number) }, b: { due: 9, at: 5 } });
    // Written once, the mark is the file's own, so a read no longer makes it again.
    expect(await getSetAside()).toEqual(raw.setAside);
  });

  // They were stored as `later` before the act was called Set aside.
  it('read from the key they were stored under before, and the next write keeps them under the new one only', async () => {
    await writeMetaFile({ version: 3, later: { a: { due: 9, at: 5 } } });
    expect(await getSetAside()).toEqual({ a: { due: 9, at: 5 } });
    await markSetAside(['b'], null, 6);
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.later).toBeUndefined();
    expect(raw.setAside).toEqual({ a: { due: 9, at: 5 }, b: { due: null, at: 6 } });
  });

  it('prefer the new key once both are there', async () => {
    await writeMetaFile({ version: 3, later: { a: { due: 9, at: 5 } }, setAside: { b: { due: null, at: 6 } } });
    expect(await getSetAside()).toEqual({ b: { due: null, at: 6 } });
  });

  // Its pause still waited for claude to leave at the quit, and pause never started or marked such a tab at launch.
  it('do not take a tab a file from before listed as paused and running as running', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a', 'b'], runningSessions: ['a', 'b'], pausedSessions: ['a'] });
    expect(await getRunningSessions()).toEqual(['b']);
  });
});
