import { test as base, expect } from '../../renderer/support/harness';
import type { App } from '../../renderer/support/harness';
import { HOME, session, type BridgeFixture } from '../../renderer/support/fixture';
import type { NeedsYou, SessionSummary } from '../../../src/shared/types';

/** What a project of the performance checks sets: how many times Chromium slows the window's CPU, 1 for none. */
export interface PerfOptions {
  throttle: number;
}

export const test = base.extend<PerfOptions>({
  throttle: [1, { option: true }],
});

export { expect };

const PROJECTS = 8;
const HOUR = 3_600_000;

/** The id of the `index`th session of the list, which the checks name to change one. */
export function sessionId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

/**
 * A list of `count` sessions over 8 projects with 3 groups each, as the budgets were measured on: one hour apart, every third loose in its project, every 7th finished, every 20th needing you, every 6th linking a PR.
 * Each title names `thing <index % 37>`, so a search for "thing " keeps every row and "thing 1" drops most of them.
 */
function sessionList(count = 1000, now = Date.now()): Partial<BridgeFixture> {
  const projects = Array.from({ length: PROJECTS }, (_, i) => `${HOME}/projects/p${i}`);
  const sessions: SessionSummary[] = Array.from({ length: count }, (_, i) =>
    session({
      id: sessionId(i),
      title: `Session ${i} about thing ${i % 37}`,
      cwd: projects[i % PROJECTS],
      repoRoot: projects[i % PROJECTS],
      lastActivity: new Date(now - i * HOUR).toISOString(),
      prs: i % 6 === 0 ? [{ repository: 'acme/app', number: i, url: `https://github.com/acme/app/pull/${i}` }] : [],
    }),
  );
  const groups = projects.flatMap((repoRoot, p) => [0, 1, 2].map((g) => ({ id: `g${p}-${g}`, name: `Group ${g}`, repoRoot })));
  const groupOf = Object.fromEntries(sessions.flatMap((s, i) => (i % 3 === 0 ? [] : [[s.id, `g${i % PROJECTS}-${Math.floor(i / PROJECTS) % 3}`]])));
  const needing: NeedsYou[] = [{ type: 'app.was-running', at: now - 5_000, how: 'quit' }];
  return {
    sessions,
    projectOrder: projects,
    activeProject: null,
    groupState: { groups, groupOf },
    finished: Object.fromEntries(sessions.filter((_, i) => i % 7 === 0).map((s) => [s.id, now - 1_000])),
    needsYou: Object.fromEntries(sessions.filter((_, i) => i % 20 === 1).map((s) => [s.id, needing])),
    history: Object.fromEntries(sessions.map((s) => [s.id, []])),
  };
}

/** Load the window on a list of `count` sessions, in All and Grouped, and wait for its rows. */
export async function bootList(app: App, page: import('@playwright/test').Page, count = 1000): Promise<void> {
  await app.boot(sessionList(count));
  await expect(page.locator('#sessions .session').first()).toBeVisible();
}
