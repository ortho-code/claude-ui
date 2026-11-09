import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { needsYouRegistry, type NeedsYouFile, type NeedsYouRegistry } from '../../shared/needsyou';
import { readJsoncFile } from '../config/jsonc';
import { log } from '../logs/log';

/**
 * The needs-you categories and types the app ships, one JSONC object per file in `bundled/needs-you/` beside `assets/` (docs/architecture/status-cues.md § Status cues).
 * Inside the packaged app's asar, which Node's fs lists and reads there (measured on Electron 43.2.0, 2026-11-06).
 */
export const bundledNeedsYouDir = path.join(app.getAppPath(), 'bundled', 'needs-you');

/**
 * Read the bundled categories and types, checked (`needsYouRegistry`); what you change of them is `needsYou` in settings.json (main/config/settings.ts).
 * A mistake in one is the app's own bug, which a unit test catches before a build; at runtime it is logged and that file left out, so the rest still count.
 */
export async function readBundledNeedsYou(dir = bundledNeedsYouDir): Promise<NeedsYouRegistry> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith('.jsonc')).sort();
  } catch (error) {
    log('error', 'needs-you', `could not list the bundled categories and types: ${(error as Error).message}`);
    return { categories: [], types: [] };
  }
  const files: NeedsYouFile[] = [];
  const unread: string[] = [];
  for (const name of names) {
    const read = await readJsoncFile(path.join(dir, name));
    if (read.status === 'read') files.push({ name, json: read.json });
    else if (read.status === 'unparsable') unread.push(`${name}: ${read.error ?? 'could not be read'}`);
  }
  const { registry, problems } = needsYouRegistry(files);
  for (const problem of [...unread, ...problems]) log('error', 'needs-you', problem);
  return registry;
}
