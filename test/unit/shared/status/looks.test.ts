import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOKS, DEFAULT_STRENGTH, PALETTE, expandedStrength, lookIds, looksProblem, resolvedLooks, strengthProblem, type Look } from '../../../../src/shared/status/looks';
import { withChanges } from '../../../../src/shared/status/needsyou';
import { bundledNeedsYou } from '../../../renderer/support/needsyou';

const registry = bundledNeedsYou();
const ordered = (...middle: string[]): string[] => ['waiting', 'busy', 'background', ...middle, 'ready', 'closed'];

describe('expandedStrength', () => {
  it("puts the app's categories at needs-you in Now's order, Your turn left out, and keeps needs-you after them", () => {
    expect(expandedStrength(DEFAULT_STRENGTH, registry)).toEqual(ordered('back-to-work', 'ready-to-merge', 'look-again', 'reminders', 'finish-up', 'needs-you'));
  });

  it('leaves a category named on its own where it is named', () => {
    expect(expandedStrength(['waiting', 'back-to-work', 'busy', 'background', 'needs-you', 'ready', 'closed'], registry)).toEqual([
      'waiting',
      'back-to-work',
      'busy',
      'background',
      'ready-to-merge',
      'look-again',
      'reminders',
      'finish-up',
      'needs-you',
      'ready',
      'closed',
    ]);
  });

  it('takes a category added later, or moved in Now, at needs-you, so a list written before it still places it', () => {
    const moved = withChanges(registry, { 'finish-up': { order: 15 } }).registry;
    expect(expandedStrength(DEFAULT_STRENGTH, moved)).toEqual(ordered('finish-up', 'back-to-work', 'ready-to-merge', 'look-again', 'reminders', 'needs-you'));
  });
});

describe('strengthProblem', () => {
  it('takes the default, and any category named once', () => {
    expect(strengthProblem(DEFAULT_STRENGTH, registry)).toBeNull();
    expect(strengthProblem(['finish-up', ...DEFAULT_STRENGTH], registry)).toBeNull();
  });

  it('names what is wrong: no list, a name twice, a status or needs-you missing, Your turn, a category nobody has', () => {
    expect(strengthProblem('waiting', registry)).toMatch(/has to be a list of names/);
    expect(strengthProblem([...DEFAULT_STRENGTH, 'busy'], registry)).toBe('"busy" is named more than once.');
    expect(strengthProblem(['waiting', 'busy', 'needs-you', 'ready'], registry)).toBe('It has to name "background", "closed" too: every status and "needs-you" once.');
    expect(strengthProblem(['your-turn', ...DEFAULT_STRENGTH], registry)).toBe('"your-turn" has no place of its own: its types are "waiting" and "ready".');
    expect(strengthProblem(['merged', ...DEFAULT_STRENGTH], registry)).toBe('"merged" is neither a status, "needs-you" nor a needs-you category.');
  });

  it('passes any other name without a registry, as for a save, and a category switched off with one', () => {
    expect(strengthProblem(['merged', ...DEFAULT_STRENGTH], null)).toBeNull();
    const off = withChanges(registry, { 'finish-up': { enabled: false } }).registry;
    expect(strengthProblem(['finish-up', ...DEFAULT_STRENGTH], off)).toBeNull();
  });
});

describe('resolvedLooks', () => {
  const resolved = (looks: Record<string, Look>): Map<string, unknown> => resolvedLooks(looks, registry);
  const needsYou = DEFAULT_LOOKS['needs-you'];

  it('gives every status its default, and every category and type but Your turn the needs-you look, with nothing set', () => {
    const looks = resolved({});
    expect([...looks.keys()]).toEqual(lookIds(registry));
    expect(looks.get('busy')).toEqual(DEFAULT_LOOKS.busy);
    expect(looks.get('finish-up')).toEqual(needsYou);
    expect(looks.get('pr.merged')).toEqual(needsYou);
    expect(looks.has('your-turn')).toBe(false);
    expect(looks.has('claude.asks')).toBe(false);
  });

  it("takes a field a category leaves out from needs-you's look, so a peach category still pulses, and its types follow it", () => {
    const looks = resolved({ 'back-to-work': { colour: 'peach' } });
    expect(looks.get('back-to-work')).toEqual({ ...needsYou, colour: PALETTE.peach });
    expect(looks.get('pr.conflict')).toEqual({ ...needsYou, colour: PALETTE.peach });
    expect(looks.get('pr.merged')).toEqual(needsYou);
  });

  it('takes what a look leaves out from the one it looks like before its category, and copies no further than the fields', () => {
    const looks = resolved({ 'pr.changes-requested': { mark: 'bug', colour: 'red' }, 'pr.checks-failed': { looksLike: 'pr.changes-requested' }, 'back-to-work': { pulse: false } });
    expect(looks.get('pr.changes-requested')).toEqual({ ...needsYou, mark: 'bug', colour: PALETTE.red, pulse: false });
    expect(looks.get('pr.checks-failed')).toEqual({ ...needsYou, mark: 'bug', colour: PALETTE.red, pulse: false });
    expect(looks.get('pr.conflict')).toEqual({ ...needsYou, pulse: false });
  });

  it("draws a category that looks like a status as that status, a still green dot for ready, and a later change to the status reaches it", () => {
    expect(resolved({ 'finish-up': { looksLike: 'ready' } }).get('pr.merged')).toEqual(DEFAULT_LOOKS.ready);
    expect(resolved({ 'finish-up': { looksLike: 'ready' }, ready: { colour: '#ABCDEF' } }).get('pr.merged')).toEqual({ ...DEFAULT_LOOKS.ready, colour: '#abcdef' });
  });

  it("draws what looks like an id the categories do not have as a category would, from your needs-you look", () => {
    expect(resolved({ 'pr.merged': { looksLike: 'plugin.reviewed' }, 'needs-you': { colour: 'teal' } }).get('pr.merged')).toEqual({ ...needsYou, colour: PALETTE.teal });
  });

  it("carries background's core to what looks like it, and a core of its own as #rrggbb", () => {
    expect(resolved({ busy: { looksLike: 'background' } }).get('busy')).toEqual(DEFAULT_LOOKS.background);
    expect(resolved({ background: { core: 'peach' } }).get('background')).toEqual({ ...DEFAULT_LOOKS.background, core: PALETTE.peach });
  });
});

describe('looksProblem', () => {
  it('passes nothing set, and every field with a value it allows', () => {
    expect(looksProblem({}, registry)).toBeNull();
    expect(looksProblem({ 'needs-you': { colour: '#123abc', mark: 'ring', core: 'teal', pulse: false }, reminders: { mark: 'clock', looksLike: 'waiting' } }, registry)).toBeNull();
  });

  it.each([
    [[], 'It has to be an object of looks by id, such as { "finish-up": { "colour": "green" } }.'],
    [{ 'your-turn': { colour: 'red' } }, '"your-turn" has no look of its own: Your turn\'s types are drawn as "waiting" and "ready".'],
    [{ 'claude.asks': { colour: 'red' } }, '"claude.asks" has no look of its own: Your turn\'s types are drawn as "waiting" and "ready".'],
    [{ merged: { colour: 'red' } }, '"merged" is neither a status, "needs-you", a category nor a type.'],
    [{ ready: 'green' }, '"ready" has to be an object of fields, such as { "colour": "green" }.'],
    [{ ready: { color: 'green' } }, '"ready" has "color", which a look does not have: it has "colour", "mark", "core", "pulse", "looksLike".'],
    [{ ready: { mark: 'star' } }, '"ready": "mark" has to be "dot", "ring", "spinner" or an icon\'s name.'],
    [{ ready: { core: 'green!' } }, '"ready": "core" has to be a colour, as "colour" is.'],
    [{ ready: { pulse: 'yes' } }, '"ready": "pulse" has to be true or false.'],
    [{ ready: { looksLike: 'ready' } }, '"ready" cannot look like itself.'],
    [{ ready: { looksLike: 'merged' } }, '"ready" looks like "merged", which is neither a status, "needs-you", a category nor a type.'],
    [{ 'finish-up': { looksLike: 'pr.merged' }, 'pr.merged': { looksLike: 'finish-up' } }, '"finish-up", "pr.merged" look like each other in a circle.'],
  ])('names the mistake in %j', (looks, why) => {
    expect(looksProblem(looks, registry)).toBe(why);
  });

  it('passes an id it cannot know without the categories, as for a check of a save, but never Your turn', () => {
    expect(looksProblem({ merged: { looksLike: 'reviewed' } }, null)).toBeNull();
    expect(looksProblem({ 'your-turn': {} }, null)).toBe('"your-turn" has no look of its own: Your turn\'s types are drawn as "waiting" and "ready".');
  });
});
