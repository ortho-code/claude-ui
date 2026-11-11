import { vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import * as path from 'node:path';

const realOs = await vi.importActual<typeof import('node:os')>('node:os');

/** A throwaway home, whose ~/.claude/projects a test fills with transcripts. */
export const testHome = mkdtempSync(path.join(realOs.tmpdir(), 'claude-ui-sess-'));

/** The folder Claude Code keeps its transcripts in, under `testHome`. */
export const projectsDir = path.join(testHome, '.claude', 'projects');

/** Every line the app logged, as `<level> <area> <message>`. */
export const logged: string[] = [];

const record = (level: string, area: string, message: string): void => {
  logged.push(`${level} ${area} ${message}`);
};

/** The log's writers, recording into `logged` instead of the log file. */
export const logStub = { log: record, logOnce: record };

/** Electron as the session listing asks it. */
export const electronStub = { shell: { trashItem: vi.fn() } };

/** node:os with its home directory at `testHome`. */
export const osStub = { ...realOs, homedir: (): string => testHome };

/** A transcript's text: one JSON line per event. */
export function jsonl(...events: unknown[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}
