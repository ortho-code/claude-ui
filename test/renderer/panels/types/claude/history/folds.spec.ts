import type { Exchange } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { historyFold } from '../../../../support/window';

const one = session();
const TIME = '2026-09-30T08:00:00.000Z';
const exchange = (parts: Exchange['parts']): Exchange => ({ id: 'request-1', time: TIME, request: 'Run the checks', kind: 'typed', replaced: false, rewound: false, parts });

test('a run of tool calls folds to one line, closed, that opens into its calls and folds again', async ({ app, page }) => {
  const parts: Exchange['parts'] = [
    { kind: 'text', id: 'message-1', time: TIME, text: 'Running them.' },
    { kind: 'tool', name: 'Bash', detail: 'npm test' },
    { kind: 'tool', name: 'Read', detail: '/repo/src/a.ts' },
    { kind: 'text', id: 'message-2', time: TIME, text: 'All pass.' },
  ];
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: [exchange(parts)] } });
  await page.getByRole('button', { name: 'Show history' }).click();
  const run = historyFold(page, 'Ran 1 shell command, read 1 file');

  await expect(run.head).toHaveAttribute('aria-expanded', 'false');
  await expect(run.body).toBeHidden();

  await run.head.click();
  await expect(run.head).toHaveAttribute('aria-expanded', 'true');
  await expect(run.body).toBeVisible();
  await expect(run.body).toHaveText(['Bash(npm test)Read(/repo/src/a.ts)']);

  await run.head.click();
  await expect(run.head).toHaveAttribute('aria-expanded', 'false');
  await expect(run.body).toBeHidden();
});
