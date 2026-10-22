import { app } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { applyEdits, modify, type JSONPath } from 'jsonc-parser';
import { tempOf, writeFileAtomic } from './atomic';
import { goodCopy, writeWithBackups } from './backup';
import { readJsonc, withoutBom } from './jsonc';
import { configBackupsDir, configRoot, settingsFile } from './paths';
import { inTurn } from './queue';

/**
 * THE FILES THE APP WRITES in the config folder, and the one way they are written: its own, whose names end in `.local.json`, such as where you left a layout, and `settings.json`, which Settings saves into (docs/architecture.md § The config folder).
 * Every other file a person writes there is theirs and the app never writes it.
 * This module is the only writer of files into the config folder (config.ts makes its folders) and refuses any other path, so that rule is held here rather than by every caller.
 * A write is an edit of the file's text rather than a rewrite of its value, so whatever a person added by hand, comments included, stays where it was.
 */

export const APP_FILE_SUFFIX = '.local.json';

/** Whether the app may write `file`: one of its own inside the config folder, or `settings.json`. */
export function isAppFile(file: string): boolean {
  const below = path.relative(configRoot, file);
  return file === settingsFile || (file.endsWith(APP_FILE_SUFFIX) && below !== '' && !below.startsWith('..') && !path.isAbsolute(below));
}

/** One change: the value at `path` set to `value`, or removed when `value` is undefined. */
export interface AppFileChange {
  path: JSONPath;
  value: unknown;
}

/** The text last written to each file, so the folder's watcher can tell the app's own write from a person's (`ownWrites`). */
const lastWritten = new Map<string, string>();

/** Where a file's copies are named from: its place below the config folder, under the backups folder. */
function backupOf(file: string): string {
  return path.join(configBackupsDir, path.relative(configRoot, file));
}

/** The version that last wrote a file, kept beside its copies; empty when none is known, which takes no version copy. */
async function writtenBy(at: string): Promise<string> {
  return (await fs.readFile(`${at}.version`, 'utf8').catch(() => '')).trim();
}

/** A file's text, or null when it is not there. */
async function textOf(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Apply `changes` to one of the files the app writes, in order, as edits of its text, making the file when it is not there.
 * Refused with nothing written: a path that is not one of those files, a file a person has left not parsing, which no edit can be made to and the app will not write over, and one left holding no object; the error says which file and what is wrong.
 * A change that leaves the text as it was writes nothing, so no copy is taken for it.
 * What an edit costs, measured: changing a value keeps every comment and the formatting; a key added to an object written on one line spreads that object over several; a key removed takes what lies between it and the key before it along, such as a comment at the end of that key's line.
 */
export function editAppFile(file: string, changes: AppFileChange[]): Promise<void> {
  if (!isAppFile(file)) return Promise.reject(new Error(`${file} is not a file the app writes: its own, which end in ${APP_FILE_SUFFIX} inside the config folder, or settings.json`));
  return inTurn(file, async () => {
    const before = await textOf(file);
    if (before !== null) {
      const read = readJsonc(before);
      if (!read.ok) throw new Error(`${path.basename(file)} does not parse, so it was not written: ${read.error}`);
      // A key can only be set in an object; the parser's own refusal names its internals rather than the file.
      if (typeof read.json !== 'object' || read.json === null || Array.isArray(read.json)) throw new Error(`${path.basename(file)} has to hold one object, { … }, so it was not written`);
    }
    const eol = before?.includes('\r\n') ? '\r\n' : '\n';
    const options = { formattingOptions: { insertSpaces: true, tabSize: 2, eol } };
    const original = before === null ? null : withoutBom(before);
    let text = original ?? `{}${eol}`;
    for (const change of changes) text = applyEdits(text, modify(text, change.path, change.value, options));
    if (text === original) return;
    const at = backupOf(file);
    const outgoing = await writtenBy(at);
    const current = app.getVersion();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeWithBackups(file, text, { at, isGood: (old) => readJsonc(old).ok, outgoing, current });
    lastWritten.set(file, text);
    // Best-effort like the copies themselves: without it, the next write takes no version copy, and nothing else is lost.
    if (outgoing !== current) await writeFileAtomic(`${at}.version`, `${current}\n`).catch(() => undefined);
  });
}

/**
 * Write `text` as one of the files the app writes, only when there is no such file yet, and say whether it did.
 * For a file the app starts for a person to edit, theirs from then on: one that is there, whatever it holds, is left as it is.
 * With nothing before it there is no copy to keep, but the version that wrote it is marked, as an edit marks it, so the first edit by a later version keeps the file as this one left it.
 */
export function startAppFile(file: string, text: string): Promise<boolean> {
  if (!isAppFile(file)) return Promise.reject(new Error(`${file} is not a file the app writes: its own, which end in ${APP_FILE_SUFFIX} inside the config folder, or settings.json`));
  return inTurn(file, async () => {
    if ((await textOf(file)) !== null) return false;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, text);
    lastWritten.set(file, text);
    const at = backupOf(file);
    // Best-effort, as an edit's mark is.
    await fs.mkdir(path.dirname(at), { recursive: true }).catch(() => undefined);
    await writeFileAtomic(`${at}.version`, `${app.getVersion()}\n`).catch(() => undefined);
    return true;
  });
}

/**
 * Take one of the app's own `.local.json` files away, its text kept first as the file's previous good copy in the backups folder, where a bad write's copy would be.
 * Nothing to do for one that is not there; refused for any file that is not one of the app's own.
 */
export function removeAppFile(file: string): Promise<void> {
  if (!isAppFile(file) || file === settingsFile) return Promise.reject(new Error(`${file} is not one of the app's own files, which end in ${APP_FILE_SUFFIX} inside the config folder`));
  return inTurn(file, async () => {
    const text = await textOf(file);
    if (text === null) return;
    const at = backupOf(file);
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.writeFile(goodCopy(at), text);
    await fs.rm(file);
    lastWritten.delete(file);
  });
}

/**
 * Whether every path a directory watch named is the app's own write as it left it: one of its files holding what was last written to it, or that file's temp file on the way there.
 * The config folder's watcher asks, so the app's own write is not pushed to the window as if somebody had changed the file.
 */
export async function ownWrites(paths: string[]): Promise<boolean> {
  const own = await Promise.all(
    paths.map(async (changed) => {
      const file = [...lastWritten.keys()].find((written) => changed === written || changed === tempOf(written));
      return file !== undefined && (await textOf(file).catch(() => null)) === lastWritten.get(file);
    }),
  );
  return own.every(Boolean);
}
