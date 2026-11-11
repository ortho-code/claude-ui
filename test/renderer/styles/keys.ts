// The capture escapes a dot inside a class name, so only an unescaped dot starts a class.
const CLASSES = /(?:\.(?:\\.|[\w-])+)+/g;
const CLASS_START = /(?<!\\)\./;

const unescaped = (name: string): string => name.replace(/\\(.)/g, '$1');
const escaped = (name: string): string => name.replace(/\./g, '\\.');

/**
 * An element key with its classes renamed by `renames` and sorted again, as the capture sorts them; everything after a line's ` | ` is its value and is left alone.
 * Renames name a class as it is, unescaped, and the classes sort by those names, since the capture sorts them before escaping.
 */
export function renamed(line: string, renames: ReadonlyMap<string, string[]>): string {
  const at = line.indexOf(' | ');
  const key = at < 0 ? line : line.slice(0, at);
  const rewritten = key.replace(CLASSES, (classes) =>
    classes
      .slice(1)
      .split(CLASS_START)
      .map(unescaped)
      .flatMap((name) => renames.get(name) ?? [name])
      .sort()
      .map((name) => `.${escaped(name)}`)
      .join(''),
  );
  return at < 0 ? rewritten : rewritten + line.slice(at);
}
