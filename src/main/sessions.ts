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
  let conversationId = '';
  let customTitle: unknown = null;
  let aiTitle: unknown = null;
  let eventCount = 0;

  const rl = readline.createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      eventCount++;

      // Title events recur through the file, so always parse them to keep the latest.
      // Otherwise stop parsing once we have cwd and the first message; keep counting.
      const isTitle = line.includes('"custom-title"') || line.includes('"ai-title"');
      if (!isTitle && cwd && firstMessage && conversationId) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      if (!cwd && typeof event.cwd === 'string') cwd = event.cwd;
      // The first user/assistant message's uuid identifies the conversation; branches share it.
      if (!conversationId && (event.type === 'user' || event.type === 'assistant') && typeof event.uuid === 'string') {
        conversationId = event.uuid;
      }
      if (event.type === 'custom-title') customTitle = event.customTitle;
      else if (event.type === 'ai-title') aiTitle = event.aiTitle;
      else if (!firstMessage && event.type === 'user') firstMessage = extractUserText(event);
    }
  } finally {
    rl.close();
  }

  // No user/assistant message means an empty stub (e.g. a background-agent artifact); hide it.
  if (!conversationId) return null;

  const title = asTitle(customTitle) || asTitle(aiTitle);
  const stat = await fs.stat(file);
  return {
    id,
    conversationId,
    cwd: cwd || decodeProjectDir(path.basename(path.dirname(file))),
    title: title.slice(0, 200),
    firstMessage: firstMessage.slice(0, 200),
    lastActivity: stat.mtime.toISOString(),
    eventCount,
  };
}

/** A title field is usable only when it is a non-empty string. */
function asTitle(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
