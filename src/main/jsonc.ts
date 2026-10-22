import { promises as fs } from 'node:fs';
import { parse, parseTree, ParseErrorCode, type ParseError } from 'jsonc-parser';
import type { ReadStatus } from '../shared/panels';

/**
 * The config folder's one format: JSON with comments and trailing commas (JSONC, the format of VS Code's settings), read here for every file in it.
 * `jsonc-parser` reads on past a mistake and hands back what it could make of the rest, which is not what a person wrote, so ANY error means the file does not parse, and only the first is named: those after it are mostly the first one's echo.
 */

/** The byte-order mark, written as its code: as a character in the source it would be invisible. */
const BOM = 0xfeff;

/** What each of the parser's errors says, worded for the person who wrote the file. */
const WORDS: Record<ParseErrorCode, string> = {
  [ParseErrorCode.InvalidSymbol]: 'an unexpected character',
  [ParseErrorCode.InvalidNumberFormat]: 'a number that cannot be read',
  [ParseErrorCode.PropertyNameExpected]: 'expected a property name in double quotes',
  [ParseErrorCode.ValueExpected]: 'expected a value',
  [ParseErrorCode.ColonExpected]: 'expected a colon',
  [ParseErrorCode.CommaExpected]: 'expected a comma',
  [ParseErrorCode.CloseBraceExpected]: 'expected a closing }',
  [ParseErrorCode.CloseBracketExpected]: 'expected a closing ]',
  [ParseErrorCode.EndOfFileExpected]: 'expected nothing more after the value',
  [ParseErrorCode.InvalidCommentToken]: 'a comment that cannot be read',
  [ParseErrorCode.UnexpectedEndOfComment]: 'a comment that is never closed',
  [ParseErrorCode.UnexpectedEndOfString]: 'a string that is never closed',
  [ParseErrorCode.UnexpectedEndOfNumber]: 'a number that is cut short',
  [ParseErrorCode.InvalidUnicode]: 'a \\u escape that is not four hex digits',
  [ParseErrorCode.InvalidEscapeCharacter]: 'an escape JSON does not have',
  [ParseErrorCode.InvalidCharacter]: 'a character a string cannot hold, such as a tab or a line break',
};

/** Where an error is, as a person counts: line and column from 1, or the end of the file, which is where a file cut short goes wrong. */
function where(text: string, offset: number): string {
  if (offset >= text.length) return 'at the end of the file';
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const column = offset - before.lastIndexOf('\n');
  return `at line ${line}, column ${column}`;
}

/** One error, worded: what is wrong, then where. */
function wordError(text: string, error: ParseError): string {
  return `${WORDS[error.error]} ${where(text, error.offset)}`;
}

/** A file's text without the byte-order mark an editor may have put first: the editor's doing rather than a mistake in the file, and the parser refuses it all the same. */
export function withoutBom(text: string): string {
  return text.charCodeAt(0) === BOM ? text.slice(1) : text;
}

/** A file's text read as JSONC: its value, or the first mistake in it worded with its place. */
export function readJsonc(text: string): { ok: true; json: unknown } | { ok: false; error: string } {
  const body = withoutBom(text);
  const errors: ParseError[] = [];
  const json: unknown = parse(body, errors, { allowTrailingComma: true });
  const first = errors[0];
  return first ? { ok: false, error: wordError(body, first) } : { ok: true, json };
}

/**
 * The keys the object at the top of a text names more than once, each once, in the order their second naming comes; none when the text holds no object.
 * The parser keeps the last of them as the value, while an edit (`jsonc-parser`'s `modify`) reaches the first, so a file naming one twice cannot be edited into saying something else.
 */
export function duplicateKeys(text: string): string[] {
  const root = parseTree(withoutBom(text), [], { allowTrailingComma: true });
  if (root?.type !== 'object') return [];
  const named = new Set<string>();
  const twice = new Set<string>();
  for (const property of root.children ?? []) {
    const key: unknown = property.children?.[0]?.value;
    if (typeof key !== 'string') continue;
    if (named.has(key)) twice.add(key);
    named.add(key);
  }
  return [...twice];
}

/** One read of a file in the config folder, as `readJsoncFile` gives it. */
export interface JsoncFileRead {
  status: ReadStatus;
  error: string | null;
  json: unknown;
}

/** A read of a file, and its text where there was one to read, for what a caller reads from the text itself. */
async function readWithText(file: string): Promise<{ read: JsoncFileRead; text: string | null }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { read: { status: 'missing', error: null, json: null }, text: null };
    return { read: { status: 'unparsable', error: (error as Error).message, json: null }, text: null };
  }
  const read = readJsonc(text);
  return { read: read.ok ? { status: 'read', error: null, json: read.json } : { status: 'unparsable', error: read.error, json: null }, text };
}

/**
 * One read of a file in the config folder: never throws, a missing file is `missing` rather than a mistake, and a file that does not parse carries what is wrong and where.
 * The one read for every file there — the layout, a type's manifest, the settings, the app's own files.
 */
export async function readJsoncFile(file: string): Promise<JsoncFileRead> {
  return (await readWithText(file)).read;
}

/** `readJsoncFile` of a file the app edits as well as reads, with the keys it names more than once (`duplicateKeys`): none for a file that is not there or does not parse. */
export async function readJsoncFileWithDuplicates(file: string): Promise<JsoncFileRead & { duplicates: string[] }> {
  const { read, text } = await readWithText(file);
  return { ...read, duplicates: read.status === 'read' && text !== null ? duplicateKeys(text) : [] };
}
