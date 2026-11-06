import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { readJsonc } from '../../../src/main/jsonc';
import { needsYouRegistry, withOverrides, type NeedsYouRead, type NeedsYouRegistry } from '../../../src/shared/needsyou';

/**
 * The needs-you categories and types the app ships, read from `bundled/needs-you/` as main reads them, by the same check (`needsYouRegistry`), so the window's checks see the real ones rather than a copy kept in step by hand.
 * Read here, on the side of the checks, since the stand-in for main runs in the page and has no files.
 */
export function bundledNeedsYou(): NeedsYouRegistry {
  const dir = path.resolve(__dirname, '../../../bundled/needs-you');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonc'))
    .sort()
    .map((name) => {
      const read = readJsonc(readFileSync(path.join(dir, name), 'utf8'));
      if (!read.ok) throw new Error(`${name}: ${read.error}`);
      return { name, json: read.json };
    });
  const { registry, problems } = needsYouRegistry(files);
  if (problems.length > 0) throw new Error(problems.join('\n'));
  return registry;
}

/** What main answers with a file of yours switching each of `ids` off, a type or a category, by the same rule (`withOverrides`). */
export function switchedOff(...ids: string[]): NeedsYouRead {
  return withOverrides(bundledNeedsYou(), ids.map((id) => ({ name: `${id}.json`, json: { id, enabled: false } })));
}
