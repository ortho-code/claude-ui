import type { IDisposable, ILink, Terminal } from '@xterm/xterm';
import { cellText, fileOfUri, pathsIn } from '../rules/paths-in';
import { showLinkTarget } from './terminal';
import { hideTooltip } from './tooltip';

/**
 * Open a `file://` link a program sends `term` (OSC 8) with `open`, where the terminal's own links open only web addresses; any other link goes where it went before.
 * xterm passes on a link that is not a web address only when asked to (`allowNonHttpProtocols`), and then underlines every such link, a `mailto:` one included; one that is no file goes to the handler before, whose refusal says only web addresses open.
 */
export function fileUriLinks(term: Terminal, open: (path: string, line: number | null) => void): void {
  const before = term.options.linkHandler;
  if (!before) return;
  term.options.linkHandler = {
    ...before,
    allowNonHttpProtocols: true,
    activate: (event, uri, range) => {
      const file = fileOfUri(uri);
      if (file) open(file.path, file.line);
      else before.activate(event, uri, range);
    },
  };
}

/** How long main's answer about a path is kept, since xterm asks again for each line the mouse crosses. */
const RESOLVED_MS = 5_000;

/**
 * Make the file paths `term` prints links: over a line, its pieces that read as paths (`pathsIn`) are resolved by main from `folder()`, and those naming a file on disk are links, a press calling `open` with the file's absolute path and the line number after it.
 * A path broken over two rows is two pieces, since a program such as claude ends its lines itself and the terminal cannot tell they belong together.
 */
export function filePathLinks(term: Terminal, folder: () => string, open: (path: string, line: number | null) => void): IDisposable {
  const resolved = new Map<string, { at: number; path: Promise<string | null> }>();
  const resolve = (dir: string, candidates: string[]): Promise<(string | null)[]> => {
    const now = Date.now();
    for (const [known, { at }] of resolved) if (at < now - RESOLVED_MS) resolved.delete(known);
    const key = (candidate: string): string => `${dir}\0${candidate}`;
    const asked = candidates.filter((candidate) => (resolved.get(key(candidate))?.at ?? -Infinity) < now - RESOLVED_MS);
    const answer = asked.length ? window.claudeUi.resolvePaths(dir, asked) : Promise.resolve([]);
    asked.forEach((candidate, at) =>
      resolved.set(key(candidate), {
        at: now,
        path: answer.then(
          (paths) => paths[at] ?? null,
          () => null,
        ),
      }),
    );
    return Promise.all(candidates.map((candidate) => resolved.get(key(candidate))?.path ?? Promise.resolve(null)));
  };
  return term.registerLinkProvider({
    provideLinks(row, callback) {
      const line = term.buffer.active.getLine(row - 1);
      const { text, cells } = line
        ? cellText(term.cols, (x) => {
            const cell = line.getCell(x);
            return { chars: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1 };
          })
        : { text: '', cells: [] };
      const matches = pathsIn(text);
      if (!matches.length) {
        callback(undefined);
        return;
      }
      void resolve(
        folder(),
        matches.map((match) => match.path),
      ).then((paths) => {
        const links = matches.flatMap((match, at): ILink[] => {
          const path = paths[at];
          if (!path) return [];
          const tip = `Open in the Editor${match.line === null ? '' : `, at line ${match.line}`}`;
          return [
            {
              range: { start: { x: cells[match.start]! + 1, y: row }, end: { x: cells[match.end - 1]! + 1, y: row } },
              text: text.slice(match.start, match.end),
              activate: () => open(path, match.line),
              hover: (event) => showLinkTarget(term, event, tip),
              leave: hideTooltip,
            },
          ];
        });
        callback(links.length ? links : undefined);
      });
    },
  });
}
