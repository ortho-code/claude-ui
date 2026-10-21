import ts from 'typescript';

/**
 * Every token of a script's code, in order, the end of the file last: the parse's leaves, without the JSDoc the parse hangs on them, which is comment.
 * A token is kept whatever hangs on it, since the end of a file whose last comment is a `/** *\/` one carries that comment as its child.
 */
export function tokens(file: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind < ts.SyntaxKind.FirstNode) found.push(node);
    else node.getChildren(file).forEach(walk);
  };
  walk(file);
  return found;
}

/** One comment of a script: where it is, the token after it (the end of the file after the last), and how many tokens come before it. */
export interface Comment {
  range: ts.CommentRange;
  next: ts.Node;
  before: number;
}

/** Every comment of a script, in order, from the parse: every comment between two tokens, an empty block's or a bracket's included. */
export function comments(file: ts.SourceFile, code: ts.Node[] = tokens(file)): Comment[] {
  const text = file.getFullText();
  return code.flatMap((next, before) => {
    // Those on the line of the token before are its trailing comments, the rest this one's leading.
    const ranges = new Map<number, ts.CommentRange>();
    for (const range of [...(ts.getTrailingCommentRanges(text, next.pos) ?? []), ...(ts.getLeadingCommentRanges(text, next.pos) ?? [])]) ranges.set(range.pos, range);
    return [...ranges.values()].sort((a, b) => a.pos - b.pos).map((range) => ({ range, next, before }));
  });
}
