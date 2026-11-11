import * as path from 'node:path';

/** Claude's tools that change a file, each with the input that names it. */
const FILE_TOOLS = new Map([
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
]);

/** A line that may call one of them, before it is parsed. */
export const FILE_TOOL_CALL = new RegExp(`"name":"(?:${[...FILE_TOOLS.keys()].join('|')})"`);

/** Claude's tools that run a shell command, each given as its `command` input. */
const SHELL_TOOLS = ['Bash', 'PowerShell'];

/** A line that may call one of them, before it is parsed. */
export const SHELL_TOOL_CALL = new RegExp(`"name":"(?:${SHELL_TOOLS.join('|')})"`);

/** The tool calls in an assistant record, each by its tool's name and its input. */
function toolCalls(event: Record<string, unknown>): { name: string; input: unknown }[] {
  const content = (event.message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null) return [];
    const { type, name, input } = part as { type?: unknown; name?: unknown; input?: unknown };
    return type === 'tool_use' && typeof name === 'string' ? [{ name, input }] : [];
  });
}

/** The commands an assistant record's shell-tool calls run. */
export function shellCommands(event: Record<string, unknown>): string[] {
  return toolCalls(event).flatMap(({ name, input }) => {
    if (!SHELL_TOOLS.includes(name)) return [];
    const command = (input as { command?: unknown } | undefined)?.command;
    return typeof command === 'string' ? [command] : [];
  });
}

/** The absolute paths an assistant record's file-tool calls change; a relative one names no file anyone can find. */
export function changedFiles(event: Record<string, unknown>): string[] {
  return toolCalls(event).flatMap(({ name, input }) => {
    const field = FILE_TOOLS.get(name);
    const file = field && typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[field] : undefined;
    return typeof file === 'string' && path.isAbsolute(file) ? [file] : [];
  });
}

/** Whether an assistant record calls the tool `name`. */
export function callsTool(event: Record<string, unknown>, name: string): boolean {
  return toolCalls(event).some((call) => call.name === name);
}
