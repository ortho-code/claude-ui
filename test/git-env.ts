import { execFileSync } from 'node:child_process';

// Git runs its hooks with the variables that point at the repository it is working in set, `GIT_INDEX_FILE` for a commit's, and every git a test or the code under it starts would read them and act on that repository's index rather than its own.
for (const name of execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).split('\n')) {
  if (name) delete process.env[name];
}
