import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The import graph of everything under src/, read with the compiler's own parser.
 * Only imports that bring in a value count, since `import type` is erased and runs nothing; the linter holds which folder may import which (eslint.config.mjs), and this holds what no lint rule here can: that no two modules run each other.
 */

const src = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every source file under `dir`, declaration files aside. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts') ? [path] : [];
  });
}

/** Whether an import or a re-export brings in a value, and so runs the module it names: `import type`, and an import of nothing but types, do not. */
function bringsValue(statement: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(statement)) return !statement.isTypeOnly;
  const clause = statement.importClause;
  if (!clause) return true;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return false;
  if (clause.name) return true;
  const bindings = clause.namedBindings;
  if (!bindings || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

/** Each source file and the source files it runs; a package, a stylesheet, or anything else not one of ours is left out. */
function valueImports(): Map<string, string[]> {
  const files = new Set(sourceFiles(src));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
    const runs: string[] = [];
    for (const statement of parsed.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.') || !bringsValue(statement)) continue;
      const base = resolve(dirname(file), specifier.text);
      const target = [`${base}.ts`, join(base, 'index.ts')].find((candidate) => files.has(candidate));
      if (target) runs.push(target);
    }
    graph.set(file, runs);
  }
  return graph;
}

/** The cycles in the graph, each as the files around it in order back to the first, found by a walk that meets a file again while it is still on the path. */
function cycles(graph: Map<string, string[]>): string[][] {
  const found: string[][] = [];
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (file: string): void => {
    const at = path.indexOf(file);
    if (at >= 0) {
      found.push([...path.slice(at), file]);
      return;
    }
    if (done.has(file)) return;
    path.push(file);
    for (const next of graph.get(file) ?? []) visit(next);
    path.pop();
    done.add(file);
  };
  for (const file of graph.keys()) visit(file);
  return found;
}

describe('the source', () => {
  const graph = valueImports();
  const named = (file: string): string => relative(src, file);

  it('is read as it is written: a value import counts and a type import does not', () => {
    const tree = (graph.get(join(src, 'renderer/panels/tree.ts')) ?? []).map(named);
    expect(tree).toContain('renderer/panels/types/command.ts');
    expect(tree).not.toContain('renderer/panels/contract.ts');
  });

  it('has no cycle of value imports, since two modules that run each other are one module with a line drawn through it', () => {
    expect(cycles(graph).map((cycle) => cycle.map(named).join(' → '))).toEqual([]);
  });
});
