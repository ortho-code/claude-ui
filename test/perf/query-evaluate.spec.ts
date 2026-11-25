import { matches } from '../../src/shared/query/evaluate';
import { coreFields } from '../../src/shared/query/fields';
import { parseQuery } from '../../src/shared/query/parse';
import type { SessionSummary } from '../../src/shared/types';
import { bundledNeedsYou } from '../renderer/support/needs-you';
import { session } from '../unit/renderer/fixtures';
import { facts, only } from '../unit/shared/query/facts';
import { expect, test } from './support/fixture';
import { loadNote, quantile, report } from './support/measure';

/** Budget 192: a view's whole query at most 5 ms over 1,000 sessions, as a pure function (the design's decision 192). */
const BUDGET = 5;
const RUNS = 50;
/** Runs before the measured ones, so the JIT has compiled the evaluator, as it has in a window that has drawn its list. */
const WARM_UP = 10;
const DAY = 86_400_000;

/** Every field, each OR part a different mix, and free words: the most a query asks per session. */
const QUERY = [
  'is:unfinished -is:pinned has:pr status:busy',
  'needs:any project:app group:shelf title:fix',
  'active:<today-30d kept:>=today-30d due:tomorrow',
  'pr:own pr.state:merged,closed is:worktree -is:gone',
  'fix login',
].join(' OR ');

const sessions: SessionSummary[] = Array.from({ length: 1000 }, (_, i) =>
  session({
    id: `s${i}`,
    title: `Session ${i} about thing ${i % 37}`,
    firstMessage: `Work on part ${i % 11} of the thing`,
    repoRoot: `/work/project-${i % 9}`,
    cwd: `/work/project-${i % 9}`,
    lastActivity: new Date(Date.now() - (i % 90) * DAY).toISOString(),
    prs: i % 4 === 0 ? [{ repository: 'acme/app', number: i, url: '' }] : [],
  }),
);

test('a query with every field over 1,000 sessions evaluates within its budget', ({ throttle }) => {
  // A pure function in the test's own Node process, which the browser's CPU throttle does not reach.
  test.skip(throttle > 1, 'measured at the machine speed only');
  const fields = coreFields(bundledNeedsYou());
  const known = facts({ now: Date.now(), pinned: only('s3', 's30'), groupName: (s) => (Number(s.id.slice(1)) % 5 === 0 ? 'Shelf' : undefined), prRole: () => 'own' });
  const times: number[] = [];
  for (let run = 0; run < WARM_UP + RUNS; run++) {
    const start = performance.now();
    const query = parseQuery(QUERY, fields.fields);
    sessions.filter((each) => matches(each, query, fields, known));
    if (run >= WARM_UP) times.push(performance.now() - start);
  }
  report('192, evaluating a query, 1,000 sessions', [{ event: 'a query with every field', values: times, budget: BUDGET }]);
  const load = loadNote();
  expect.soft(quantile(times, 0.95), `95th percentile of a query's evaluation${load ? ` (${load})` : ''}`).toBeLessThanOrEqual(BUDGET);
});
