import { describe, it, expect } from 'vitest';
import { postedNodes, postedPrs, prCreates } from '../../../../src/main/sessions/posted-prs';

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

  it('reads the command behind the shell’s words that open one, such as then or do', () => {
    expect(postedPrs('if [ "$head" = "$want" ]; then gh api -X POST repos/acme/app/pulls/3/reviews --input r.json; else echo moved; fi')).toEqual([pr('acme/app', 3)]);
    expect(postedPrs('for n in 1 2; do gh pr comment "$n" --repo acme/app --body x; done')).toEqual([]);
    expect(postedPrs('for n in 1 2; do gh pr comment https://github.com/acme/app/pull/4 --body x; done')).toEqual([pr('acme/app', 4)]);
    expect(postedPrs('if ! time GH_HOST=github.com gh pr review 5 --repo acme/app --approve; then exit 1; fi')).toEqual([pr('acme/app', 5)]);
    expect(postedPrs('{ gh pr review 6 --repo acme/app --approve; }')).toEqual([pr('acme/app', 6)]);
  });

  it('links nothing for a PR created in the browser, which is not posted on', () => {
    expect(postedPrs('gh pr create --web --repo acme/app --head me:fix')).toEqual([]);
  });

  it('links every PR a command posts on, in its order', () => {
    expect(postedPrs('gh pr comment 2 --repo acme/app --body a && gh pr review 1 --repo acme/web --approve')).toEqual([pr('acme/app', 2), pr('acme/web', 1)]);
  });
});

describe('prCreates', () => {
  // The command session 2a3c1b9a ran on 2026-11-09, its title shortened.
  it('reads a PR created in the browser, by the repository and the branch the command names', () => {
    const command = 'cd /repo/.claude/worktrees/fix && git push origin HEAD && gh pr create --web --repo ScientaNL/Scienta --base develop --head alleknalle:fix --title "Setup creates the host folders"';
    expect(prCreates(command)).toEqual([{ repository: 'ScientaNL/Scienta', head: 'alleknalle:fix' }]);
  });

  it('reads the short flags and values given after an equals sign', () => {
    expect(prCreates('gh pr create -w -R=acme/app -H fix')).toEqual([{ repository: 'acme/app', head: 'fix' }]);
    expect(prCreates('gh pr create --repo=https://github.com/acme/app --head=fix --web')).toEqual([{ repository: 'acme/app', head: 'fix' }]);
  });

  it('reads nothing without --web, or with the repository or the branch left to the checkout', () => {
    expect(prCreates('gh pr create --repo acme/app --head fix --title x')).toEqual([]);
    expect(prCreates('gh pr create --web --head fix')).toEqual([]);
    expect(prCreates('gh pr create --web --repo acme/app')).toEqual([]);
  });

  it('never takes a value such as a title for the flag it spells', () => {
    expect(prCreates('gh pr create --title --web --repo acme/app --head fix')).toEqual([]);
  });
});

describe('postedNodes', () => {
  const REVIEW = 'PRR_kwDOAHFIWc8AAAABXz2W6w';

  // Session 70186dca submitted a review a person had started by hand on the PR, 2026-11-13.
  it('keeps the review a GraphQL mutation that posts names by its id', () => {
    const command = `gh api graphql -f query='mutation($rid:ID!){submitPullRequestReview(input:{pullRequestReviewId:$rid,event:REQUEST_CHANGES}){pullRequestReview{state url comments{totalCount}}}}' -f rid=${REVIEW}`;
    expect(postedNodes(command)).toEqual([REVIEW]);
  });

  // The same session added its comments to that review with the query and the id each in a shell variable, set earlier in the command.
  it('reads the query and the id through the variables the command sets for them', () => {
    const command = [
      'set -e',
      "Q='mutation($rid:ID!,$path:String!,$line:Int!,$body:String!){addPullRequestReviewThread(input:{pullRequestReviewId:$rid,path:$path,line:$line,side:RIGHT,body:$body}){thread{id}}}'",
      `RID=${REVIEW}`,
      `post(){ out=$(gh api graphql -f query="$Q" -f rid=$RID -f path="$1" -F line=$2 -f body="$(cat $3)"); echo "$3 -> $out"; echo "$out" | grep -q '"id":"PRRT_' || { echo "FAILED at $3"; exit 1; }; }`,
      'post src/a.ts 40 c1.md',
    ].join('; ');
    expect(postedNodes(command)).toEqual([REVIEW]);
  });

  it('keeps an id written into the query, such as a comment on a PR by its id', () => {
    expect(postedNodes(`gh api graphql -f query='mutation{addComment(input:{subjectId:"PR_kwDOAHFIWc8AAAABO5dE8A",body:"x"}){clientMutationId}}'`)).toEqual(['PR_kwDOAHFIWc8AAAABO5dE8A']);
  });

  it('keeps the thread a reply in it names', () => {
    expect(postedNodes(`gh api graphql -f query='mutation($t:ID!,$b:String!){addPullRequestReviewThreadReply(input:{pullRequestReviewThreadId:$t,body:$b}){comment{id}}}' -f t=PRRT_kwDOAHFIWc63Ec_T -f b=thanks`)).toEqual(['PRRT_kwDOAHFIWc63Ec_T']);
  });

  it('keeps nothing for a query that reads, or a mutation that posts nothing, such as resolving a thread', () => {
    expect(postedNodes(`gh api graphql -f query='query($id:ID!){node(id:$id){id}}' -f id=${REVIEW}`)).toEqual([]);
    expect(postedNodes(`gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{id}}}' -f t=PRRT_kwDOAHFIWc63Ec_T`)).toEqual([]);
  });

  it('keeps nothing for an id held in a variable the command does not set', () => {
    expect(postedNodes(`gh api graphql -f query='mutation($rid:ID!){submitPullRequestReview(input:{pullRequestReviewId:$rid,event:COMMENT}){clientMutationId}}' -f rid=$RID`)).toEqual([]);
  });

  it('keeps nothing from a gh call that is not GraphQL', () => {
    expect(postedNodes(`gh api repos/acme/app/pulls/1/reviews -f event=COMMENT -f body=${REVIEW}`)).toEqual([]);
  });
});
