import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const src = fileURLToPath(new URL('../../../src/', import.meta.url));

/** Each channel a file names in a call of `pattern`'s, as `kind channel`: the kind is `answers` for a call that waits for an answer and `tells` for one that does not. */
function channels(text: string, pattern: RegExp, answers: string): string[] {
  return [...text.matchAll(pattern)].map(([, call, channel]) => `${call === answers ? 'answers' : 'tells'} ${channel}`);
}

const preload = readFileSync(join(src, 'preload', 'preload.ts'), 'utf8');
const main = readdirSync(join(src, 'main'), { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.ts'))
  .map((file) => readFileSync(join(src, 'main', file), 'utf8'))
  .join('\n');

describe('the channels between the window and main', () => {
  // Read from the source rather than run: main registers its handlers as it starts, and nothing here starts it.
  it('are each handled in main exactly once, as the window calls them, and main handles none the window never calls', () => {
    const asked = channels(preload, /ipcRenderer\.(invoke|send)\('([^']+)'/g, 'invoke');
    const handled = channels(main, /ipcMain\.(handle|on)\('([^']+)'/g, 'handle');
    expect(asked.length).toBeGreaterThan(0);
    expect([...handled].sort()).toEqual([...new Set(asked)].sort());
  });
});
