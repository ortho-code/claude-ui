import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../src/shared/defaults';
import type { LayoutReport, NodeState, NodeStateChange, PanelRunRequest, PanelState } from '../../../../src/shared/panels';
import type { UiState } from '../../../../src/shared/types';
import { type BridgeFixture, CONFIG_ROOT, HOME, localLayoutWith, noLocalLayout, PROJECT, session } from '../../support/fixture';
import type { App } from '../../support/harness';

// What the layout tree's checks share (the panel-layout work, phases 3 and 4, and the five checks nobody confirmed at the time): one layout file, and ways to read back what ran and what was kept.
export const OTHER = `${HOME}/projects/other`;
export const here = session();
export const there = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Over there', cwd: OTHER, repoRoot: OTHER });

/** The README's second example with both commands as command lines, so nothing asks main about a script: a collapsible sidebar, a drawer with a shell, and a railed right-hand group of two commands. */
export const LAYOUT = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', min: 220, collapsible: true, panels: [{ id: 'sessions', type: 'sessions' }] },
      {
        id: 'main',
        rows: [
          { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
          { id: 'drawer', size: 0.3, collapsible: true, panels: [{ id: 'shell', type: 'terminal' }] },
        ],
      },
      {
        id: 'right',
        size: '360px',
        collapsible: true,
        panels: [
          { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } },
          { id: 'checks', type: 'command', title: 'Checks', icon: 'check', options: { command: 'make check' } },
        ],
      },
    ],
  },
};

/** The layout file holding `json`, and the app's file beside it holding `nodes`, or none. */
export const withLayout = (json: unknown, nodes?: Record<string, NodeState>): Partial<BridgeFixture> & { layout: LayoutReport } => ({
  sessions: [here, there],
  projectOrder: [PROJECT, OTHER],
  layout: { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, status: 'read' as const, error: null, json, types: [], local: nodes ? localLayoutWith(nodes) : noLocalLayout() },
});

/** The tree's state as `meta.json` kept it before the config folder, not moved yet. */
export const withLegacyState = (panelState: Partial<PanelState>): { uiState: UiState } => ({ uiState: { ...defaultUi(), panelState: { ...defaultUi().panelState, ...panelState } } });

export const runs = async (app: App, entry: string): Promise<PanelRunRequest[]> =>
  (await app.calls('runPanel')).map(([request]) => request as PanelRunRequest).filter((request) => request.entryId === entry);

/** Every change the window asked main to keep in the app's file beside the layout, in order. */
export const keptChanges = async (app: App): Promise<NodeStateChange[]> => (await app.calls('setLayoutState')).flatMap(([changes]) => changes as NodeStateChange[]);

export const railItem = (page: Page, label: RegExp): Locator => page.locator('.panel-rail').getByRole('button', { name: label });
