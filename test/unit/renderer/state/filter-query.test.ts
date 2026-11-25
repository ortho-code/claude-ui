import { describe, expect, it } from 'vitest';
import { store } from '../../../../src/renderer/state/app';
import { filterQuery, queryReads } from '../../../../src/renderer/state/filter-query';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';

const needsYouTypes = bundledNeedsYou();
const read = (query: string): ReturnType<typeof filterQuery> => filterQuery({ needsYouTypes, filter: { ...store.get().filter, query } });

describe('filterQuery', () => {
  it('is no query for an empty field', () => {
    expect(read('  ')).toEqual({ inForce: null, problems: [] });
  });

  it('keeps the last query that read in force while the field does not read, with why', () => {
    const pinned = read('is:pinned').inForce;
    const halfTyped = read('is:pinned is:runn');
    expect(halfTyped.inForce).toBe(pinned);
    expect(halfTyped.problems.map((problem) => problem.message)).toEqual(['runn is not a value of is:.']);
  });

  it('keeps no filter in force after an empty field, when the next text does not read', () => {
    read('');
    expect(read('is:').inForce).toBeNull();
  });
});

describe('queryReads', () => {
  const reads = (query: string): ReturnType<typeof queryReads> => queryReads({ needsYouTypes, filter: { ...store.get().filter, query } });

  it("says which of the list's quiet slices a query reads", () => {
    expect(reads('fix is:pinned')).toEqual({ tabs: false, running: false, statuses: false });
    expect(reads('is:working')).toEqual({ tabs: true, running: false, statuses: false });
    expect(reads('is:unfinished OR is:running')).toEqual({ tabs: true, running: true, statuses: false });
    expect(reads('needs:any')).toEqual({ tabs: false, running: false, statuses: true });
    expect(reads('-status:busy')).toEqual({ tabs: false, running: false, statuses: true });
    expect(reads('is:asking')).toEqual({ tabs: false, running: false, statuses: true });
  });
});
