import type { PrAuthor, PrRole, SessionPr, SessionSummary } from '../types';

/** The approvals each repository needs before a PR counts as approved, by `owner/name`, as `approvals` in settings.json holds them. */
export type Approvals = Readonly<Record<string, number>>;

/** Whether `value` may be `approvals`, and if not, every mistake in it. */
export function approvalsProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'It has to be an object of repositories and the approvals each needs, such as { "acme/app": 2 }.';
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const [repository, count] of Object.entries(value)) {
    if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) problems.push(`"${repository}" is not a repository written as owner/name.`);
    if (!Number.isInteger(count) || (count as number) < 1) problems.push(`"${repository}" needs a whole number of 1 or more.`);
    const other = seen.get(repository.toLowerCase());
    if (other !== undefined) problems.push(`"${other}" and "${repository}" name one repository.`);
    seen.set(repository.toLowerCase(), repository);
  }
  return problems.length === 0 ? null : problems.join(' ');
}

/** The approvals `repository` needs, matched without regard to case, since a PR record may spell a repository either way; null where none is set, so GitHub's decision alone says approved. */
export function approvalsRequired(approvals: Approvals, repository: string): number | null {
  const wanted = repository.toLowerCase();
  return Object.entries(approvals).find(([named]) => named.toLowerCase() === wanted)?.[1] ?? null;
}

/** Every role, in the order a PR's role is decided: yours first, then one you review, then anyone else's. */
export const PR_ROLES: readonly PrRole[] = ['own', 'reviewing', 'other'];

/** Your role on a PR from what GitHub says: whether you wrote it, have a submitted review on it, and are asked to review it. */
export function roleOf(authored: boolean, reviewed: boolean, asked: boolean): PrRole {
  if (authored) return 'own';
  return reviewed || asked ? 'reviewing' : 'other';
}

/**
 * A PR's full reference, `owner/repo#number`, as the session spells it: what a needs-you reason keeps, and what search matches beside its title.
 * What tells two PRs apart is `prKey`; how one is shown is `prName`.
 */
export function prReference(pr: Pick<SessionPr, 'repository' | 'number'>): string {
  return `${pr.repository}#${pr.number}`;
}

/** The PR a reference names (`prReference`), as a needs-you reason keeps one: its repository is everything before the last `#`. */
export function prOfReference(reference: string): Pick<SessionPr, 'repository' | 'number'> {
  const at = reference.lastIndexOf('#');
  return { repository: reference.slice(0, at), number: Number(reference.slice(at + 1)) };
}

/** The longest a PR's title runs on a line that names it among other words, such as the needs-you line, before it is cut. */
export const SHORT_TITLE = 60;

/**
 * How a PR is named wherever it is shown: `#36773 · Scheduler tick per host`, with `owner/repo` before the number where `withRepository`, and the number alone while its title is not known.
 * A title longer than `cut` is cut there, with an ellipsis.
 */
export function prName(pr: Pick<SessionPr, 'repository' | 'number'>, title: string | undefined, withRepository: boolean, cut = Infinity): string {
  const number = withRepository ? prReference(pr) : `#${pr.number}`;
  if (title === undefined || title === '') return number;
  return `${number} · ${title.length > cut ? `${title.slice(0, cut - 1).trimEnd()}…` : title}`;
}

/** Whether `prs` name more than one repository, without regard to its capitals: where a PR is named with its repository (`prName`). */
export function spansRepositories(prs: readonly Pick<SessionPr, 'repository'>[]): boolean {
  return new Set(prs.map((pr) => pr.repository.toLowerCase())).size > 1;
}

/** How a PR's author is named: the name they set, else their login. */
export function authorName(author: PrAuthor): string {
  return author.name ?? author.login;
}

/**
 * What tells two PRs apart, in one session and across them: the reference without regard to its repository's capitals, which Claude Code's records and the commands claude runs spell both ways, as GitHub reads them.
 * Every map and comparison of PRs goes by it, PR status and what was last seen of a PR included; only what is shown keeps its spelling.
 */
export function prKey(pr: Pick<SessionPr, 'repository' | 'number'>): string {
  return referenceKey(prReference(pr));
}

/** `prKey` of a PR given by its reference, as a needs-you reason keeps one. */
export function referenceKey(reference: string): string {
  return reference.toLowerCase();
}

const PR_PAGE = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/([1-9]\d*)(?:[/?#]\S*)?$/;

/** The PR a GitHub pull request page is, its address put as the PR's own page, so one under its files or a comment names it too; null for any other address. */
export function prFromUrl(url: string): SessionPr | null {
  const page = PR_PAGE.exec(url);
  if (page === null) return null;
  const [, repository, number] = page as unknown as [string, string, string];
  return { repository, number: Number(number), url: `https://github.com/${repository}/pull/${number}` };
}

/** The sessions with the PRs the app linked them to (`prLinks`, by session id) first, since such a link is made when a panel row starts the session, then the transcript's, each PR once (`prKey`). */
export function withPrLinks<S extends Pick<SessionSummary, 'id' | 'prs'>>(sessions: readonly S[], prLinks: Readonly<Record<string, readonly SessionPr[]>>): S[] {
  return sessions.map((session) => {
    const linked = prLinks[session.id];
    if (linked === undefined || linked.length === 0) return session;
    const prs = new Map<string, SessionPr>();
    for (const pr of [...linked, ...session.prs]) if (!prs.has(prKey(pr))) prs.set(prKey(pr), pr);
    return { ...session, prs: [...prs.values()] };
  });
}
