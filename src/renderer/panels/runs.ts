import type { PanelRunEvent } from '../../shared/panels';

/**
 * Every panel run's events arrive on ONE channel, whichever type started the run: this is the one subscription to it, handing each event to the panel whose entry it names.
 * A panel listens under its entry key while it is mounted; the key is unique across the layout, so no two panels share one, whatever their types.
 */

type RunListener = (token: string, event: PanelRunEvent) => void;

const listeners = new Map<string, RunListener>();
let subscribed = false;

/** Hear the run events for the entry `key` until the function handed back is called, which a panel does when it unmounts. */
export function listenForRuns(key: string, listener: RunListener): () => void {
  if (!subscribed) {
    subscribed = true;
    window.claudeUi.onPanelRun((entryId, token, event) => listeners.get(entryId)?.(token, event));
  }
  listeners.set(key, listener);
  return () => {
    // Only its own: a panel mounted afresh under the same key may already listen in its place.
    if (listeners.get(key) === listener) listeners.delete(key);
  };
}
