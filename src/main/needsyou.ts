import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { needsYouRegistry, withOverrides, type NeedsYouFile, type NeedsYouRead, type NeedsYouRegistry } from '../shared/needsyou';
import { readJsoncFile } from './jsonc';
import { log } from './log';
import { needsYouDir } from './paths';

/**
 * The needs-you categories and types the app ships, one JSONC object per file in `bundled/needs-you/` beside `assets/` (docs/architecture.md § Status cues).
 * Inside the packaged app's asar, which Node's fs lists and reads there (measured on Electron 43.2.0, 2026-11-06).
 */
export const bundledNeedsYouDir = path.join(app.getAppPath(), 'bundled', 'needs-you');

/**
 * What each of your files last held when it parsed, by path: a file that stops parsing stays in force as it last read, and is named until it parses again, as the layout and the settings are (docs/principles.md § Failures show).
 * Forgotten for a file that is gone, so deleting one takes its change away.
 */
const lastParsed = new Map<string, unknown>();

/**
 * The files in `dir` whose names end in `suffix`, each read, by name; one that does not read is named in `problems`, and a folder that is not there has none.
 * With `keepLast`, one that does not parse is used as it last parsed (`lastParsed`), still named.
 */
async function readFolder(dir: string, suffix: string, problems: string[], keepLast = false): Promise<NeedsYouFile[]> {
  let names: string[];
  try {
    names = (await fs.readdir(dir)).filter((name) => name.endsWith(suffix)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') problems.push(`could not list ${dir}: ${(error as Error).message}`);
    return [];
  }
  const files: NeedsYouFile[] = [];
  const present = new Set(names.map((name) => path.join(dir, name)));
  if (keepLast) for (const file of [...lastParsed.keys()]) if (path.dirname(file) === dir && !present.has(file)) lastParsed.delete(file);
  for (const name of names) {
    const file = path.join(dir, name);
    const read = await readJsoncFile(file);
    if (read.status === 'read') {
      files.push({ name, json: read.json });
      if (keepLast) lastParsed.set(file, read.json);
      continue;
    }
    if (read.status === 'missing') continue;
    const kept = keepLast && lastParsed.has(file);
    problems.push(`${name}: ${read.error ?? 'could not be read'}${kept ? '; it is used as it last read' : ''}`);
    if (kept) files.push({ name, json: lastParsed.get(file) });
  }
  return files;
}

/**
 * Read the bundled categories and types, checked (`needsYouRegistry`).
 * A mistake in one is the app's own bug, which a unit test catches before a build; at runtime it is logged and that file left out, so the rest still count.
 */
export async function readBundledNeedsYou(dir = bundledNeedsYouDir): Promise<NeedsYouRegistry> {
  const problems: string[] = [];
  let names: string[] | null = null;
  try {
    names = await fs.readdir(dir);
  } catch (error) {
    log('error', 'needs-you', `could not list the bundled categories and types: ${(error as Error).message}`);
  }
  if (names === null) return { categories: [], types: [] };
  const { registry, problems: wrong } = needsYouRegistry(await readFolder(dir, '.jsonc', problems));
  for (const problem of [...problems, ...wrong]) log('error', 'needs-you', problem);
  return registry;
}

/**
 * The bundled categories and types with your files under `needs-you/` in the config folder applied (`withOverrides`): each a `.json` file, JSONC as every file there is, naming one by its id.
 * What is wrong with yours is logged and handed back, for the window to say; a file of yours with a mistake is not used at all, and the rest are.
 */
export async function readNeedsYou(bundled: NeedsYouRegistry, dir = needsYouDir): Promise<NeedsYouRead> {
  const problems: string[] = [];
  const files = await readFolder(dir, '.json', problems, true);
  const read = withOverrides(bundled, files);
  const all = [...problems.map((problem) => `needs-you/${problem}`), ...read.problems.map((problem) => `needs-you/${problem}`)];
  for (const problem of all) log('warn', 'needs-you', problem);
  return { registry: read.registry, problems: all };
}
