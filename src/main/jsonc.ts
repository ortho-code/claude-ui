import { parse, ParseErrorCode, type ParseError } from 'jsonc-parser';

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
