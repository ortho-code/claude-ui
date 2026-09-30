import { createBridge } from './bridge';

// The script the harness puts in the page before the window's own: bundled on its own, so the window's code is loaded exactly as it ships.
const { api, control } = createBridge(window.__claudeUiFixture);
window.claudeUi = api;
window.__claudeUiTest = control;
