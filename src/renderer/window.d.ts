import type { ClaudeUiApi } from '../shared/types';

// The preload's API as the renderer sees it, in a file of its own so that any project holding a renderer module knows it, the tests' included.
declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}
