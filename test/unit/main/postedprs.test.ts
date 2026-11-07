import { describe, it, expect } from 'vitest';
import { postedPrs } from '../../../src/main/postedprs';

const pr = (repository: string, number: number) => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });

describe('postedPrs', () => {
  it('links a review or comment posted with gh pr naming the repository', () => {
    expect(postedPrs('gh pr review 36504 --repo ScientaNL/Scienta --approve')).toEqual([pr('ScientaNL/Scienta', 36504)]);
    expect(postedPrs("gh pr comment 12 -R acme/app --body 'Looks good'")).toEqual([pr('acme/app', 12)]);
    expect(postedPrs('gh pr review --repo=acme/app 7 --comment -b x')).toEqual([pr('acme/app', 7)]);
  });

  it('links a review or comment on a PR named by its URL', () => {
    expect(postedPrs('gh pr comment https://github.com/acme/app/pull/9 --body hi')).toEqual([pr('acme/app', 9)]);
  });

  it('links nothing for a PR named by a bare number, which names no repository', () => {
    expect(postedPrs('gh pr review 36504 --approve')).toEqual([]);
  });

  it('never takes a number given as the body for the PR', () => {
    expect(postedPrs('gh pr comment --body 42 --repo acme/app')).toEqual([]);
    expect(postedPrs('gh pr comment -b 42 --repo acme/app 5')).toEqual([pr('acme/app', 5)]);
  });

  it('links nothing for a gh pr command that does not post', () => {
    expect(postedPrs('gh pr view 5 --repo acme/app')).toEqual([]);
    expect(postedPrs('gh pr diff 5 --repo acme/app')).toEqual([]);
  });

  it('links a gh api request that sends a body to a PR’s reviews or comments, replies included', () => {
    expect(postedPrs('gh api repos/acme/app/pulls/3/reviews --input review.json')).toEqual([pr('acme/app', 3)]);
    expect(postedPrs("gh api -X POST /repos/acme/app/pulls/3/comments -f body='x' -f path=a.ts")).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('gh api repos/acme/app/pulls/3/comments/991/replies -f body=thanks')).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('gh api --method=POST https://api.github.com/repos/acme/app/pulls/3/reviews')).toEqual([pr('acme/app', 3)]);
  });

  it('links nothing for a gh api read of a PR’s reviews or comments', () => {
    expect(postedPrs("gh api --paginate repos/acme/app/pulls/3/comments --jq '.[]|{id,user:.user.login}'")).toEqual([]);
    expect(postedPrs('gh api -X GET repos/acme/app/pulls/3/comments -f per_page=100')).toEqual([]);
  });

  it('links nothing under a placeholder repository', () => {
    expect(postedPrs('gh api repos/{owner}/{repo}/pulls/3/reviews -f event=APPROVE')).toEqual([]);
  });

  it('judges each invocation on its own, so a body sent by another does not make a read a post', () => {
    expect(postedPrs('gh api repos/acme/app/pulls/3/comments; gh api repos/acme/app/issues/3/comments -f body=x')).toEqual([]);
    expect(postedPrs('gh api repos/acme/app/pulls/3/comments | jq length && gh api graphql -f query=x')).toEqual([]);
  });

  it('keeps a quoted pipe or semicolon inside its invocation', () => {
    expect(postedPrs("gh api repos/acme/app/pulls/3/comments --jq '.[]|.id; .x' -f body=x")).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('gh api repos/acme/app/pulls/3/comments -f body="one | two; three\nfour"')).toEqual([pr('acme/app', 3)]);
  });

  it('reads a heredoc as the body of its invocation, never as commands', () => {
    const command = ["gh pr review 3 --repo acme/app --comment --body-file - <<'EOF'", 'Run gh pr comment 8 --repo acme/app first.', 'EOF', 'echo done'].join('\n');
    expect(postedPrs(command)).toEqual([pr('acme/app', 3)]);
  });

  it('reads a short option’s value given after an equals sign', () => {
    expect(postedPrs('gh pr review 5 -R=acme/app --approve')).toEqual([pr('acme/app', 5)]);
    expect(postedPrs('gh api -X=POST repos/acme/app/pulls/3/reviews')).toEqual([pr('acme/app', 3)]);
  });

  it('takes a repository given with GitHub’s host or page address', () => {
    expect(postedPrs('gh pr review 5 --repo github.com/acme/app --approve')).toEqual([pr('acme/app', 5)]);
    expect(postedPrs('gh pr review 5 --repo https://github.com/acme/app --approve')).toEqual([pr('acme/app', 5)]);
  });

  it('keeps a redirection inside its invocation', () => {
    expect(postedPrs('gh api repos/acme/app/pulls/3/comments 2>&1 -f body=x')).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('gh api 2>/dev/null repos/acme/app/pulls/3/reviews -f event=APPROVE')).toEqual([pr('acme/app', 3)]);
  });

  it('reads a command run in a substitution or a subshell', () => {
    expect(postedPrs('ID=$(gh api repos/acme/app/pulls/3/reviews -f event=APPROVE --jq .id)')).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('(gh pr review 5 --repo acme/app --approve)')).toEqual([pr('acme/app', 5)]);
  });

  it('counts gh only as the command an invocation runs', () => {
    expect(postedPrs('echo gh pr review 5 --repo acme/app --approve')).toEqual([]);
    expect(postedPrs('GH_HOST=github.com gh pr review 5 --repo acme/app --approve')).toEqual([pr('acme/app', 5)]);
  });

  it('links every PR a command posts on, in its order', () => {
    expect(postedPrs('gh pr comment 2 --repo acme/app --body a && gh pr review 1 --repo acme/web --approve')).toEqual([pr('acme/app', 2), pr('acme/web', 1)]);
  });
});
