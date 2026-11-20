import { describe, expect, it } from 'vitest';
import { questionOf, setOnTheirOwn, soundDiffPicks, withRootQuestion } from '../../../../src/shared/diff/picks';

describe('soundDiffPicks', () => {
  it('keeps the sound questions of single checkouts and drops the rest', () => {
    expect(soundDiffPicks({ question: 'since', roots: { '/a': 'uncommitted', '/b': 'everything', '/c': 7 } })).toEqual({ question: 'since', roots: { '/a': 'uncommitted' } });
  });

  it('leaves the checkouts out when none has a sound question of its own', () => {
    expect(soundDiffPicks({ question: 'unpushed', roots: { '/b': 'everything' } })).toEqual({ question: 'unpushed' });
    expect(soundDiffPicks({ question: 'unpushed', roots: 'nope' })).toEqual({ question: 'unpushed' });
  });

  it('drops the picks whole when the panel’s question is not sound, whatever its checkouts say', () => {
    expect(soundDiffPicks({ question: 'nope', roots: { '/a': 'since' } })).toBeNull();
  });
});

describe('a checkout’s question', () => {
  const picks = { question: 'since' as const, roots: { '/old': 'uncommitted' as const } };

  it('is its own where it is set to one, and the panel’s otherwise', () => {
    expect(questionOf(picks, '/old')).toBe('uncommitted');
    expect(questionOf(picks, '/fix')).toBe('since');
  });

  it('is set on its own only for the checkouts asked about that have one, the panel’s own question included', () => {
    expect(setOnTheirOwn(picks, ['/fix', '/old'])).toEqual(['/old']);
    expect(setOnTheirOwn(picks, ['/fix'])).toEqual([]);
    expect(setOnTheirOwn({ question: 'since', roots: { '/fix': 'since' } }, ['/fix'])).toEqual(['/fix']);
  });

  it('is set on its own, and back to the panel’s, the checkouts left out once none is set', () => {
    const set = withRootQuestion({ question: 'since' }, '/fix', 'unpushed');
    expect(set).toEqual({ question: 'since', roots: { '/fix': 'unpushed' } });
    expect(withRootQuestion(withRootQuestion(set, '/old', 'uncommitted'), '/fix', null)).toEqual({ question: 'since', roots: { '/old': 'uncommitted' } });
    expect(withRootQuestion(set, '/fix', null)).toEqual({ question: 'since' });
  });
});
