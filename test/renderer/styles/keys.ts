/** An element key with its classes renamed by `renames` and sorted again, as the capture sorts them; everything after a line's ` | ` is its value and is left alone. */
export function renamed(line: string, renames: ReadonlyMap<string, string[]>): string {
  const at = line.indexOf(' | ');
  const key = at < 0 ? line : line.slice(0, at);
  const rewritten = key.replace(/(?:\.[\w-]+)+/g, (classes) =>
    classes
      .slice(1)
      .split('.')
      .flatMap((name) => renames.get(name) ?? [name])
      .sort()
      .map((name) => `.${name}`)
      .join(''),
  );
  return at < 0 ? rewritten : rewritten + line.slice(at);
}
