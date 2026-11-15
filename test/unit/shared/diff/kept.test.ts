import { describe, expect, it } from 'vitest';
import { keptBasesOf, withKeptBase } from '../../../../src/shared/diff/kept';

describe('keptBasesOf', () => {
  it('keeps sound entries and drops what is not a ref name', () => {
    expect(
      keptBasesOf({
        '/a': { project: 'upstream/develop', branches: { feature: 'origin/feature', bad: 3, empty: ' ' } },
        '/b': { project: 7, branches: {} },
        '/c': 'nonsense',
      }),
    ).toEqual({ '/a': { project: 'upstream/develop', branches: { feature: 'origin/feature' } } });
  });

  it('reads nothing kept from a file without the field', () => {
    expect(keptBasesOf(undefined)).toEqual({});
  });
});

describe('withKeptBase', () => {
  it('sets a branch base beside the project one, and clears each on its own', () => {
    let all = withKeptBase({}, '/a', null, 'upstream/develop');
    all = withKeptBase(all, '/a', 'feature', 'origin/main');
    expect(all).toEqual({ '/a': { project: 'upstream/develop', branches: { feature: 'origin/main' } } });
    all = withKeptBase(all, '/a', 'feature', null);
    expect(all).toEqual({ '/a': { project: 'upstream/develop', branches: {} } });
  });

  it('takes a project out once nothing is kept for it', () => {
    const all = withKeptBase({ '/a': { project: 'upstream/develop', branches: {} } }, '/a', null, null);
    expect(all).toEqual({});
  });
});
