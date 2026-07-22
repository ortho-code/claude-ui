import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import type { SessionSummary } from '../shared/types';

const projectsDir = path.join(os.homedir(), '.claude', 'projects');

/** Read every session transcript under ~/.claude/projects and summarize each. */
export async function listSessions(): Promise<SessionSummary[]> {
  let projectDirs: string[];
  try {
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });
    projectDirs = entries.filter((e) => e.isDirectory()).map((e) => path.join(projectsDir, e.name));
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const dir of projectDirs) {
    const entries = await fs.readdir(dir);
    for (const name of entries) {
      if (name.endsWith('.jsonl')) files.push(path.join(dir, name));
    }
  }

  const summaries = await Promise.all(files.map(summarizeFile));
  return summaries
    .filter((s): s is SessionSummary => s !== null)
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

/** Summarize one transcript without loading the whole file into memory. */
async function summarizeFile(file: string): Promise<SessionSummary | null> {
  const id = path.basename(file, '.jsonl');
  let cwd = '';
  let firstMessage = '';
  let eventCount = 0;

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      eventCount++;

      // Stop parsing content once we have what we need; keep counting via the cheap path below.
      if (cwd && firstMessage) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (!cwd && typeof event.cwd === 'string') cwd = event.cwd;
      if (!firstMessage && event.type === 'user') firstMessage = extractUserText(event);
    }
  } finally {
    rl.close();
  }

  if (eventCount === 0) return null;

  const stat = await fs.stat(file);
  return {
    id,
    cwd: cwd || decodeProjectDir(path.basename(path.dirname(file))),
    firstMessage: firstMessage.slice(0, 200),
    lastActivity: stat.mtime.toISOString(),
    eventCount,
  };
}

/** Pull display text out of a user event, whether content is a string or an array of blocks. */
function extractUserText(event: Record<string, unknown>): string {
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((b): b is { type: string; text: string } => typeof b?.text === 'string' && b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text;
  }
  return '';
}

/** Fallback when no event carried a cwd: Claude Code encodes the path with dashes. */
function decodeProjectDir(name: string): string {
  return name.replace(/-/g, '/');
}
