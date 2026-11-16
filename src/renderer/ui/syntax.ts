import { createCssVariablesTheme, createHighlighterCoreSync, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import css from '@shikijs/langs/css';
import dockerfile from '@shikijs/langs/dockerfile';
import go from '@shikijs/langs/go';
import html from '@shikijs/langs/html';
import ini from '@shikijs/langs/ini';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import json5 from '@shikijs/langs/json5';
import jsonc from '@shikijs/langs/jsonc';
import markdown from '@shikijs/langs/markdown';
import php from '@shikijs/langs/php';
import powershell from '@shikijs/langs/powershell';
import python from '@shikijs/langs/python';
import rust from '@shikijs/langs/rust';
import scss from '@shikijs/langs/scss';
import shellscript from '@shikijs/langs/shellscript';
import sql from '@shikijs/langs/sql';
import toml from '@shikijs/langs/toml';
import twig from '@shikijs/langs/twig';
import typescript from '@shikijs/langs/typescript';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';
import './syntax.css';

/**
 * The app's syntax colour, as colour ranges over lines rather than markup, so a surface can lay its own marks over them, such as a diff's changed words.
 * Shiki, with the grammars imported one by one, since the window is one bundle and every grammar imported is in it, and its JavaScript regex engine, which needs no WASM.
 * Colours are CSS variables (`--syntax-token-*`, syntax.css), so they follow the app's palette rather than a theme's.
 * A file whose language is not here is plain text.
 */

/** The grammar for each extension, lowercased, where it is not the extension itself; a file's language is these, else its extension when that names a grammar. */
const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  inc: 'php',
  phtml: 'php',
  htm: 'html',
  md: 'markdown',
  yml: 'yaml',
  // NEON, the format of Nette's configuration, reads close to YAML, which has a grammar where NEON has none; an odd token may colour wrong.
  neon: 'yaml',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  svg: 'xml',
  xlf: 'xml',
  conf: 'ini',
  dockerfile: 'docker',
  py: 'python',
  ps1: 'powershell',
  rs: 'rust',
};

/** The grammar for a file known by its whole name. */
const BY_NAME: Record<string, string> = { Dockerfile: 'docker' };

const GRAMMARS = [css, dockerfile, go, html, ini, javascript, json, json5, jsonc, markdown, php, powershell, python, rust, scss, shellscript, sql, toml, twig, typescript, xml, yaml];

/**
 * The languages a file may be coloured as, by the grammars' own names: the ones imported above, each module listing what it embeds first and itself last.
 * What they embed is loaded too (PHP brings SQL, Twig brings Ruby and through it C and Lua) and colours code inside a file of a picked language, but a file of its own stays plain, so which files are coloured is this list and not whatever an embed brought along, nor an alias, such as `ps` for PowerShell, which is PostScript's extension.
 */
const PICKED = new Set(GRAMMARS.map((grammar) => grammar.at(-1)!.name));

const THEME = createCssVariablesTheme({ name: 'app', variablePrefix: '--syntax-' });

/** The bit of a token's font style that says italic, in the TextMate engine's numbering. */
const ITALIC = 1;

/** Built on the first file coloured, so a window that never shows a diff never compiles a grammar. */
let highlighter: HighlighterCore | null = null;

const loaded = (): HighlighterCore => (highlighter ??= createHighlighterCoreSync({ themes: [THEME], langs: GRAMMARS, engine: createJavaScriptRegexEngine() }));

/** A run of a line in one colour: from `start` up to `end`, characters within the line, and the colour as a CSS value. */
export interface Colour {
  start: number;
  end: number;
  colour: string;
  italic: boolean;
}

/** The language a file is coloured as, by its name, or null for one coloured as plain text. */
export function languageOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (Object.hasOwn(BY_NAME, name)) return BY_NAME[name]!;
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  const language = BY_EXTENSION[extension] ?? extension;
  return PICKED.has(language) ? language : null;
}

/**
 * The colours of each of `lines`, read as one text, so a line inside a block comment or a string that spans lines colours as one.
 * Each line's ranges are its own, counted from its start; a stretch the grammar leaves in the text's own colour has no range.
 */
export function colourLines(lines: readonly string[], language: string): Colour[][] {
  const tokens = loaded().codeToTokensBase(lines.join('\n'), { lang: language, theme: 'app' });
  let lineStart = 0;
  return lines.map((line, at) => {
    const ranges: Colour[] = [];
    for (const token of tokens[at] ?? []) {
      const italic = ((token.fontStyle ?? 0) & ITALIC) !== 0;
      // Text in the text's own colour gets no colour of its own, unless it is italic, as a markdown emphasis is.
      const plain = !token.color || token.color.includes('--syntax-foreground');
      if (plain && !italic) continue;
      // An offset counts from the start of the whole text.
      const start = token.offset - lineStart;
      ranges.push({ start, end: start + token.content.length, colour: plain ? '' : token.color!, italic });
    }
    lineStart += line.length + 1;
    return ranges;
  });
}
