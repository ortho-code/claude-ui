import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { chooseProject, switcherRollUp } from '../../../../support/window';

// The switcher's title counts what asks for you outside the project on show, and every project in All; each entry counts its own project (docs/architecture.md § Status cues).
const OTHER = `${HOME}/projects/other`;
const THIRD = `${HOME}/projects/third`;
const here = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Waiting here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Waiting there', cwd: OTHER, repoRoot: OTHER });
const ready = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'Ready there', cwd: OTHER, repoRoot: OTHER });
const working = session({ id: '00000000-0000-4000-8000-0000000000d4', title: 'Working elsewhere', cwd: THIRD, repoRoot: THIRD });
const fixture = {
  sessions: [here, there, ready, working],
  projectOrder: [PROJECT, OTHER, THIRD],
  activeProject: null,
  statuses: { [here.id]: 'waiting', [there.id]: 'waiting', [ready.id]: 'ready', [working.id]: 'busy' },
};
const title = '#switcher-badge';

test('the title counts what asks for you in every project in All, and outside the project on show once one is', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator(title)).toHaveText('3');
  await expect(page.locator(title)).toHaveAttribute('data-tooltip', '3 sessions need you');

  await chooseProject(page, 'demo');
  await expect(page.locator(title)).toHaveText('2');
  await expect(page.locator(title)).toHaveClass(/\bwaiting\b/);
  await expect(page.locator(title)).toHaveAttribute('data-tooltip', '2 sessions in other projects need you');

  await chooseProject(page, 'other');
  await expect(page.locator(title)).toHaveText('1');
  await expect(page.locator(title)).toHaveAttribute('data-tooltip', '1 session in other projects needs you');
});

test('with nothing asking for you elsewhere and something at work there, the title is the busy dot without a number', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here, working], projectOrder: [PROJECT, THIRD], statuses: { [here.id]: 'waiting', [working.id]: 'busy' } });
  await chooseProject(page, 'demo');
  await expect(page.locator(title)).toBeVisible();
  await expect(page.locator(title)).toHaveClass(/\bnudge\b.*\bbusy\b/);
  await expect(page.locator(title)).toHaveText('');
  await expect(page.locator(title)).toHaveAttribute('data-tooltip', '1 session in other projects is working');

  await chooseProject(page, 'third');
  await expect(page.locator(title)).toHaveText('1');
});

test('with nothing elsewhere at all, the title has no badge', async ({ app, page }) => {
  await app.boot({ ...fixture, sessions: [here], projectOrder: [PROJECT], statuses: { [here.id]: 'waiting' } });
  await chooseProject(page, 'demo');
  await expect(page.locator(title)).toBeHidden();
});

test('each entry counts its own project, the one on show too, and All every project', async ({ app, page }) => {
  await app.boot({ ...fixture, activeProject: PROJECT });
  await page.locator('#switcher-current').click();
  await expect(switcherRollUp(page, 'All')).toHaveText('3');
  await expect(switcherRollUp(page, 'demo')).toHaveText('1');
  await expect(switcherRollUp(page, 'other')).toHaveText('2');
  await expect(switcherRollUp(page, 'other')).toHaveAttribute('data-tooltip', '2 sessions need you');
  await expect(switcherRollUp(page, 'third')).toHaveClass(/\bbusy\b/);
  await expect(switcherRollUp(page, 'third')).toHaveText('');
});
