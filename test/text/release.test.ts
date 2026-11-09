import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root } from './tracked';

/**
 * What a release reads from the repository, kept in step: the version `package.json` and both of its places in `package-lock.json` carry, `## Unreleased` as the changelog's first section, and the newest version's section, which `release.yml` publishes as the release notes, found by the workflow's own program and holding entries.
 */

const read = (file: string): string => readFileSync(join(root, file), 'utf8');

/** The version each place a release bumps carries, by where it is. */
export function versionsOf(manifest: { version: string }, lock: { version: string; packages: Record<string, { version?: string }> }): Record<string, string | undefined> {
  return { 'package.json': manifest.version, 'package-lock.json': lock.version, 'package-lock.json packages[""]': lock.packages['']?.version };
}

/** The changelog's version sections, top to bottom, by the name each heading gives: `Unreleased`, then each version. */
export function sectionsOf(changelog: string): string[] {
  return [...changelog.matchAll(/^## (\S+)/gm)].map(([, name]) => name);
}

/** The awk program `release.yml` extracts a version's notes with, as the workflow writes it. */
export function notesProgram(workflow: string): string {
  const program = /awk -v v="\$version" '\n([\s\S]*?)\n\s*' CHANGELOG\.md/.exec(workflow)?.[1];
  if (program === undefined) throw new Error('release.yml no longer extracts the notes with awk as this test reads it');
  return program;
}

/** What that program prints for `version` from `changelog`. */
export function notesFor(program: string, changelog: string, version: string): string {
  return execFileSync('awk', ['-v', `v=${version}`, program], { input: changelog, encoding: 'utf8' });
}

describe('a release', () => {
  const manifest = JSON.parse(read('package.json')) as { version: string };
  const changelog = read('CHANGELOG.md');

  it('carries one version in package.json and in both places of package-lock.json', () => {
    const versions = versionsOf(manifest, JSON.parse(read('package-lock.json')) as Parameters<typeof versionsOf>[1]);
    expect(new Set(Object.values(versions))).toEqual(new Set([manifest.version]));
  });

  it('keeps Unreleased first, and the newest version below it is the one package.json carries', () => {
    const [first, newest] = sectionsOf(changelog);
    expect(first).toBe('Unreleased');
    expect(newest).toBe(manifest.version);
  });

  it("publishes the newest version's section, entries and all, by release.yml's own program", () => {
    const notes = notesFor(notesProgram(read('.github/workflows/release.yml')), changelog, manifest.version);
    expect(notes.split('\n')[0]).toMatch(new RegExp(`^## ${manifest.version.replace(/\./g, '\\.')}( |$)`));
    expect(notes).toMatch(/^- /m);
    expect(notes).not.toMatch(/^## Unreleased/m);
  });

  it('what the checks read, on a made-up changelog', () => {
    const made = '# Changelog\n\n## Unreleased\n\n### Added\n\n- Next.\n\n## 1.1.0 — 2026-01-02\n\n### Fixed\n\n- A bug.\n\n## 1.0.0 — 2026-01-01\n\n- First.\n';
    expect(sectionsOf(made)).toEqual(['Unreleased', '1.1.0', '1.0.0']);
    const program = notesProgram(read('.github/workflows/release.yml'));
    expect(notesFor(program, made, '1.1.0')).toBe('## 1.1.0 — 2026-01-02\n\n### Fixed\n\n- A bug.\n\n');
    expect(notesFor(program, made, '1.1')).toBe('');
    expect(versionsOf({ version: '1.1.0' }, { version: '1.1.0', packages: { '': { version: '1.0.0' } } })).toEqual({ 'package.json': '1.1.0', 'package-lock.json': '1.1.0', 'package-lock.json packages[""]': '1.0.0' });
  });
});
