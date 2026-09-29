/**
 * Reading the records of a session transcript (`~/.claude/projects/<dir>/<id>.jsonl`, one JSON record per line).
 * What a record says is decided here once, for every reader of the transcript: the session list's summary, and the history of a session's requests.
 */

/**
 * A message that is pure local-command plumbing — the `<local-command-caveat>` preamble a session gets when it starts with local commands, or captured `<local-command-stdout>` output — is not a usable first message; blank it so the latch waits for the first real prompt instead.
 */
export function displayableUserText(text: string): string {
  return /^<local-command-(caveat|stdout)>/.test(text.trim()) ? '' : text;
}

/**
 * A session started by a slash command wraps its first message in tags — `<command-message>word</command-message>\n<command-name>/cmd</command-name>` plus an optional (possibly empty) `<command-args>…</command-args>` — which reads as junk in the row.
 * Render it as the command line the user effectively typed: "/cmd args".
 * Anything else passes through untouched.
 */
export function commandLabel(text: string): string {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]!.trim();
  if (!name) return text;
  const args = text.match(/<command-args>([^<]*)<\/command-args>/)?.[1]!.trim();
  return args ? `${name} ${args}` : name;
}

/** Pull display text out of a user event, whether content is a string or an array of blocks. */
export function extractUserText(event: Record<string, unknown>): string {
  const message = event.message as { content?: unknown } | undefined;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    const text = (content as ({ type?: unknown; text?: unknown } | null)[])
      .filter((b): b is { type: string; text: string } => typeof b?.text === 'string' && b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text;
  }
  return '';
}
