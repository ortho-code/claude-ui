import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, tracked } from './tracked';

/**
 * A link in a document, `[text](path#anchor)`, leads to a file that exists and, into a markdown file, to a heading it has.
 * The anchor is the one GitHub gives a heading: lower case, every character but letters, digits, `_`, `-` and spaces dropped, spaces as `-`, and `-1`, `-2` after a heading's later namesakes.
 * A web address is not followed, and a link inside code is not a link.
 * A skill's `${CLAUDE_SKILL_DIR}` is the folder of the file that names it, as Claude Code fills it in.
 */

/** The anchors a markdown text's headings get, outside its code blocks. */
export function anchorsOf(text: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const line of withoutFences(text).split('\n')) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1];
    if (heading === undefined) continue;
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\- ]/gu, '')
      .replace(/ /g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

/** The text without its fenced code blocks, whose lines are neither headings nor links. */
function withoutFences(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
}

/** The text without its code, fenced or in a span, so what code shows is not read as a link. */
function withoutCode(text: string): string {
  return withoutFences(text).replace(/`[^`\n]*`/g, '');
}

/** Each link in `docs` that leads nowhere, as `file: target`; `exists` says whether a path from the repository's root is there. */
export function deadLinks(docs: { file: string; text: string }[], exists: (path: string) => boolean): string[] {
  const texts = new Map(docs.map(({ file, text }) => [file, text]));
  return docs.flatMap(({ file, text }) =>
    [...withoutCode(text).matchAll(/\]\(([^)\s]+)\)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target))
      .filter((target) => {
        const hash = target.indexOf('#');
        const path = hash < 0 ? target : target.slice(0, hash);
        const anchor = hash < 0 ? null : target.slice(hash + 1);
        const to = path === '' ? file : normalize(join(dirname(file), decodeURI(path.replace(/^\$\{CLAUDE_SKILL_DIR\}\//, ''))));
        if (!texts.has(to) && !exists(to)) return true;
        if (anchor === null || !to.endsWith('.md')) return false;
        return !anchorsOf(texts.get(to) ?? '').has(anchor);
      })
      .map((target) => `${file}: ${target}`),
  );
}

describe('links in the docs', () => {
  it('each lead to a file that exists, and to a heading it has', () => {
    expect(deadLinks(tracked(/\.md$/), (path) => existsSync(join(root, path)))).toEqual([]);
  });

  it('what counts as a dead link, and what does not', () => {
    const guide = { file: 'docs/guide.md', text: '# Guide\n\n## The window’s checks\n\n## `cwd` and `scope`\n\n## Notes\n\n## Notes\n' };
    const there = (path: string): boolean => path === 'LICENSE' || path === 'docs';
    const dead = (text: string): string[] => deadLinks([guide, { file: 'README.md', text }], there);
    expect(dead('[a](docs/guide.md) [b](docs/guide.md#the-windows-checks) [c](docs/guide.md#cwd-and-scope) [d](docs/guide.md#notes-1)')).toEqual([]);
    expect(dead('[e](LICENSE) [f](docs) [g](https://example.com/x#y) [h](mailto:a@b.c)')).toEqual([]);
    expect(dead('`[i](gone.md)` and\n\n```\n[j](gone.md)\n```\n')).toEqual([]);
    expect(dead('[k](gone.md)')).toEqual(['README.md: gone.md']);
    expect(dead('[l](docs/guide.md#the-attention-strip)')).toEqual(['README.md: docs/guide.md#the-attention-strip']);
    expect(dead('[m](#why)')).toEqual(['README.md: #why']);
    expect(deadLinks([guide, { file: 'docs/skill.md', text: '[p](${CLAUDE_SKILL_DIR}/guide.md#notes)' }], there)).toEqual([]);
    expect(deadLinks([{ file: 'docs/guide.md', text: '## Here\n\n[n](#here) [o](../README.md)' }, { file: 'README.md', text: '' }], there)).toEqual([]);
  });
});
