import { beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * Electron as meta.json's store asks it: its folder under the test's own temp dir, and a version a test can move.
 * `getVersion` feeds the `appVersion` stamp and the version-change backup.
 */
export const electronStub = {
  app: { getPath: (): string | undefined => process.env.TEST_USERDATA, getVersion: (): string => process.env.TEST_APPVERSION ?? '1.0.0' },
};

let dir = '';

/** The folder the current test's meta.json is in. */
export function metaDir(): string {
  return dir;
}

/** A fresh folder for meta.json before each test, and the app version back to 1.0.0 unless a test moves it. */
export function useMetaDir(): void {
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-meta-'));
    process.env.TEST_USERDATA = dir;
    delete process.env.TEST_APPVERSION;
  });
}

export async function writeMetaFile(contents: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(contents));
}

export async function readMetaFile(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')) as Record<string, unknown>;
}

/** The audit log's lines so far, one per write of meta.json: how a check counts the writes a call made. */
export async function auditLines(): Promise<string[]> {
  const text = await fs.readFile(path.join(dir, 'meta-audit.log'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean);
}
