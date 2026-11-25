import { prFromUrl, prKey } from '../../shared/sessions/prs';
import type { SessionPr } from '../../shared/types';

/**
 * The PRs a shell command posts a review or comment on: `gh pr review|comment` naming the repository with `--repo` or the PR by its URL, and a `gh api` POST, given as the method or implied by a body, under `repos/<owner>/<repo>/pulls/<number>/reviews` or `…/comments`.
 * Each invocation in the command is judged on its own, so a `-f` in one does not make a read in another a post, and `gh` counts only as the command an invocation runs, never as a word handed to another.
 * A PR named by a bare number, or under a `{owner}/{repo}` placeholder, names no repository and is left out.
 */
export function postedPrs(command: string): SessionPr[] {
  return ghCalls(command).flatMap((args) => {
    const target = args[0] === 'pr' && (args[1] === 'review' || args[1] === 'comment') ? namedTarget(args.slice(2), prFromUrl) : args[0] === 'api' ? apiPostTarget(args.slice(1), REVIEW_ENDPOINT) : null;
    return target ? [prOf(target)] : [];
  });
}

/** A PR a command creates: the repository it is for and the branch it is from, `owner:branch` for a fork's. */
export interface PrCreate {
  repository: string;
  head: string;
}

/**
 * The PRs a shell command creates, `gh pr create` naming both the repository with `--repo` and the branch with `--head`, with or without `--web`.
 * The command's output cannot be relied on to name the PR: `--web` prints none, since the PR is made in the browser afterwards, and an output piped through a filter may have lost the line that does.
 * Read as `postedPrs` reads its commands; one that leaves either to the folder's checkout names nothing sure, and is left out, as is a `--dry-run`, which creates no PR.
 */
export function prCreates(command: string): PrCreate[] {
  return ghCalls(command).flatMap((args) => {
    if (args[0] !== 'pr' || args[1] !== 'create') return [];
    const { options } = parsed(args.slice(2), CREATE_VALUE_FLAGS);
    const last = (...flags: string[]): string | null | undefined => options.filter((option) => flags.includes(option.flag)).at(-1)?.value;
    if (options.some((option) => option.flag === '--dry-run')) return [];
    const repository = REPOSITORY.exec(last('--repo', '-R') ?? '')?.[1];
    const head = last('--head', '-H');
    return repository && head ? [{ repository, head }] : [];
  });
}

/** The GraphQL mutations that post a review or a comment, each naming what it posts on by its id; resolving a thread posts nothing, as a REST call that does not post links nothing. */
const POSTING_MUTATION = /\b(?:addPullRequestReview|addPullRequestReviewThread|addPullRequestReviewThreadReply|addPullRequestReviewComment|submitPullRequestReview|addComment)\b/;

/** An id GitHub gives a review, a review thread, a review comment or a PR. */
const NODE_ID = /\b(?:PRRC|PRRT|PRR|PR)_[\w-]{8,}/g;

/** A field's value that is a shell variable alone, `$NAME` or `${NAME}`, which the shell expands and the command's words keep as written. */
const VARIABLE = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})$/;

/**
 * The ids a shell command posts a review or comment on through `gh api graphql`: a call whose `query` field names a mutation that posts (`POSTING_MUTATION`), and every id of a review, a review thread, a review comment or a PR in its fields, the query included (`NODE_ID`), each once.
 * A field that is a shell variable alone is read through a plain assignment to it in the same command (`assignmentsIn`), as a query or an id kept in a variable before the call is; one the command does not set, or sets with `export`, `local` or `declare`, reads as nothing, and a body given with `--input` is not read.
 */
export function postedNodes(command: string): string[] {
  const set = assignmentsIn(command);
  const nodes = ghCalls(command).flatMap((args) => {
    if (args[0] !== 'api' || args[1] !== 'graphql') return [];
    const fields = parsed(args.slice(2), API_VALUE_FLAGS).options.flatMap(({ flag, value }) => (FIELD_FLAGS.has(flag) && value?.includes('=') ? [fieldOf(value, set)] : []));
    if (!POSTING_MUTATION.test(fields.find((field) => field.name === 'query')?.value ?? '')) return [];
    return fields.flatMap((field) => field.value.match(NODE_ID) ?? []);
  });
  return [...new Set(nodes)];
}

/** What a comment posted by number names: the repository and the number, which GitHub gives issues and PRs from one count, so it may be either. */
export interface PostedNumber {
  repository: string;
  number: number;
}

/**
 * The issues or PRs a shell command posts a comment on by number: a `gh api` POST under `repos/<owner>/<repo>/issues/<number>/comments`, which takes a PR's conversation comments as well as an issue's, and `gh issue comment` naming the repository with `--repo` or the issue by its page.
 * Read as `postedPrs` reads its commands; each repository and number once, in the order first posted.
 */
export function postedNumbers(command: string): PostedNumber[] {
  const posted = new Map<string, PostedNumber>();
  for (const args of ghCalls(command)) {
    const target = args[0] === 'issue' && args[1] === 'comment' ? namedTarget(args.slice(2), issueFromUrl) : args[0] === 'api' ? apiPostTarget(args.slice(1), ISSUE_COMMENTS_ENDPOINT) : null;
    if (target && !posted.has(prKey(target))) posted.set(prKey(target), target);
  }
  return [...posted.values()];
}

/** A `name=value` field, its value read through `set` when it is a shell variable alone. */
function fieldOf(word: string, set: ReadonlyMap<string, string>): { name: string; value: string } {
  const equals = word.indexOf('=');
  const value = word.slice(equals + 1);
  const variable = VARIABLE.exec(value);
  return { name: word.slice(0, equals), value: variable ? (set.get((variable[1] ?? variable[2])!) ?? '') : value };
}

/** The shell variables a command sets before the commands its invocations run, or as an invocation of its own, by name, the last kept. */
function assignmentsIn(command: string): Map<string, string> {
  const set = new Map<string, string>();
  for (const words of invocations(command)) {
    for (const word of words.slice(0, commandAt(words))) {
      if (ASSIGNMENT.test(word)) set.set(word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1));
    }
  }
  return set;
}

/** The arguments of each `gh` an invocation of `command` runs, after `gh` itself, without redirections. */
function ghCalls(command: string): string[][] {
  return invocations(command).flatMap((words) => {
    const at = commandAt(words);
    const program = words[at];
    if (program !== 'gh' && !program?.endsWith('/gh')) return [];
    return [words.slice(at + 1).filter((word) => !REDIRECTION.test(word))];
  });
}

/** `gh pr review|comment`'s options that take a value, which is never the PR. */
const PR_VALUE_FLAGS = new Set(['-b', '--body', '-F', '--body-file', '-R', '--repo']);

/** `gh pr create`'s options that take a value, so a value such as a title is never read as a flag. */
const CREATE_VALUE_FLAGS = new Set(['-t', '--title', '-b', '--body', '-F', '--body-file', '-B', '--base', '-H', '--head', '-R', '--repo', '-a', '--assignee', '-l', '--label', '-m', '--milestone', '-p', '--project', '-r', '--reviewer', '-T', '--template', '--recover']);

/** `gh api`'s options that take a value, which is never the endpoint. */
const API_VALUE_FLAGS = new Set(['-X', '--method', '-f', '--raw-field', '-F', '--field', '-H', '--header', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache', '-p', '--preview']);

/** `gh api`'s options that each give one field of the request, `name=value`. */
const FIELD_FLAGS = new Set(['-f', '--raw-field', '-F', '--field']);

/** `gh api`'s options that send a body, which makes a request without a method of its own a POST. */
const BODY_FLAGS = new Set([...FIELD_FLAGS, '--input']);

const REVIEW_ENDPOINT = /^(?:https:\/\/api\.github\.com)?\/?repos\/([^/{}\s]+\/[^/{}\s]+)\/pulls\/([1-9]\d*)\/(?:reviews|comments)(?:[/?].*)?$/;
/** Where a comment on an issue's or a PR's conversation is posted, by its number. */
const ISSUE_COMMENTS_ENDPOINT = /^(?:https:\/\/api\.github\.com)?\/?repos\/([^/{}\s]+\/[^/{}\s]+)\/issues\/([1-9]\d*)\/comments(?:\?.*)?$/;
/** A GitHub issue page, or a part of one such as a comment. */
const ISSUE_PAGE = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/issues\/([1-9]\d*)(?:[/?#]\S*)?$/;
/** A repository as `--repo` takes it: `owner/name`, or with GitHub's host or page address before it. */
const REPOSITORY = /^(?:(?:https:\/\/)?github\.com\/)?([^/\s]+\/[^/\s]+?)\/?$/;

/** A redirection, which is no argument of the command it follows. */
const REDIRECTION = /^(?:\d*[<>]|&>)/;

/** An environment assignment before the command an invocation runs. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/;

/** The shell's words that may stand before the command an invocation runs: the reserved words that open a command, and `time`, which times the one after it. */
const OPENING_WORDS = new Set(['if', 'then', 'else', 'elif', 'while', 'until', 'do', '!', '{', 'time']);

/** Where in an invocation's words the command it runs stands: after the words that open it, then after its environment assignments. */
function commandAt(words: readonly string[]): number {
  let at = 0;
  while (at < words.length && OPENING_WORDS.has(words[at]!)) at++;
  while (at < words.length && ASSIGNMENT.test(words[at]!)) at++;
  return at;
}

function prOf({ repository, number }: PostedNumber): SessionPr {
  return { repository, number, url: `https://github.com/${repository}/pull/${number}` };
}

/** The flag a word is and the value it carries in itself (`--repo=x`, `-XPOST`, `-X=POST`), or null for a word that is no flag. */
function flagOf(word: string): { flag: string; value: string | null } | null {
  if (!word.startsWith('-') || word === '-') return null;
  const equals = word.indexOf('=');
  if (word.startsWith('--')) return equals === -1 ? { flag: word, value: null } : { flag: word.slice(0, equals), value: word.slice(equals + 1) };
  if (word.length === 2) return { flag: word, value: null };
  return { flag: word.slice(0, 2), value: word.slice(word[2] === '=' ? 3 : 2) };
}

/** Each option and the value it takes, and the positional words, of `args`, where `takesValue` names the options that take one. */
function parsed(args: readonly string[], takesValue: ReadonlySet<string>): { options: { flag: string; value: string | null }[]; positional: string[] } {
  const options: { flag: string; value: string | null }[] = [];
  const positional: string[] = [];
  for (let at = 0; at < args.length; at++) {
    const word = args[at]!;
    const flag = flagOf(word);
    if (flag === null) {
      positional.push(word);
      continue;
    }
    if (takesValue.has(flag.flag) && flag.value === null) options.push({ flag: flag.flag, value: args[++at] ?? null });
    else options.push(flag);
  }
  return { options, positional };
}

/** The issue a GitHub issue page is; null for any other address. */
function issueFromUrl(url: string): PostedNumber | null {
  const page = ISSUE_PAGE.exec(url);
  return page ? { repository: page[1]!, number: Number(page[2]) } : null;
}

/** What a `gh pr|issue` command posting on one names: the page `fromPage` reads, or a number with the repository in `--repo`; null for a bare number or nothing. */
function namedTarget(args: readonly string[], fromPage: (url: string) => PostedNumber | null): PostedNumber | null {
  const { options, positional } = parsed(args, PR_VALUE_FLAGS);
  const target = positional[0];
  if (target === undefined) return null;
  const page = fromPage(target);
  if (page) return page;
  const repository = options.filter((option) => option.flag === '--repo' || option.flag === '-R').at(-1)?.value;
  const named = repository ? REPOSITORY.exec(repository) : null;
  return /^[1-9]\d*$/.test(target) && named ? { repository: named[1]!, number: Number(target) } : null;
}

/** The repository and number a `gh api` request posts to under `endpoint`, a POST given as the method or implied by a body; null for any other request. */
function apiPostTarget(args: readonly string[], endpoint: RegExp): PostedNumber | null {
  const { options, positional } = parsed(args, API_VALUE_FLAGS);
  const matched = positional[0] === undefined ? null : endpoint.exec(positional[0]);
  if (matched === null) return null;
  const method = options.filter((option) => option.flag === '-X' || option.flag === '--method').at(-1)?.value;
  const posts = method ? method.toUpperCase() === 'POST' : options.some((option) => BODY_FLAGS.has(option.flag));
  return posts ? { repository: matched[1]!, number: Number(matched[2]) } : null;
}

/**
 * A command's invocations, each as its words with the shell's quoting taken off: split at an unquoted `;`, `&`, `&&`, `|`, `||`, line break, `(`, `)` or backquote, which covers a `$(…)` substitution, with comments and heredoc bodies left out, and a redirection such as `2>&1` kept as a word.
 * Enough of the shell's syntax to tell one invocation from the next, not all of it: a substitution inside double quotes stays part of the quoted word, so a command in it, or a heredoc it opens, is not read.
 */
function invocations(command: string): string[][] {
  const all: string[][] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  const heredocs: Heredoc[] = [];
  const endWord = (): void => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endInvocation = (): void => {
    endWord();
    if (words.length > 0) all.push(words);
    words = [];
  };
  let at = 0;
  while (at < command.length) {
    const char = command[at]!;
    if (char === "'" || char === '"') {
      const quoted = char === "'" ? singleQuoted(command, at) : doubleQuoted(command, at);
      word += quoted.text;
      inWord = true;
      at = quoted.at;
      continue;
    }
    if (char === '\\') {
      if (command[at + 1] === '\n') at += 2;
      else {
        word += command.charAt(at + 1);
        inWord = true;
        at += 2;
      }
      continue;
    }
    if (char === '#' && !inWord) {
      while (at < command.length && command[at] !== '\n') at++;
      continue;
    }
    if (command.startsWith('<<', at) && command[at + 2] !== '<') {
      endWord();
      const opened = heredocStart(command, at);
      if (opened.heredoc) heredocs.push(opened.heredoc);
      at = opened.at;
      continue;
    }
    if (char === '\n') {
      endInvocation();
      at = pastHeredocs(command, at + 1, heredocs.splice(0));
      continue;
    }
    if (char === '&' && (command[at - 1] === '>' || command[at - 1] === '<' || command[at + 1] === '>')) {
      word += char;
      inWord = true;
      at++;
      continue;
    }
    if (char === ';' || char === '&' || char === '|' || char === '(' || char === ')' || char === '`') {
      endInvocation();
      at++;
      continue;
    }
    if (char === ' ' || char === '\t') {
      endWord();
      at++;
      continue;
    }
    word += char;
    inWord = true;
    at++;
  }
  endInvocation();
  return all;
}

/** The text of the single-quoted string that opens at `at`, taken as it is, and where the command goes on after its closing quote; one never closed runs to the end. */
function singleQuoted(command: string, at: number): { text: string; at: number } {
  const close = command.indexOf("'", at + 1);
  const end = close === -1 ? command.length : close;
  return { text: command.slice(at + 1, end), at: end + 1 };
}

/** The text of the double-quoted string that opens at `at`, with a backslash taken off before `"`, `\`, `$` and a backquote, and where the command goes on after its closing quote. */
function doubleQuoted(command: string, at: number): { text: string; at: number } {
  let text = '';
  at++;
  while (at < command.length && command[at] !== '"') {
    if (command[at] === '\\' && at + 1 < command.length && '"\\$`'.includes(command[at + 1]!)) at++;
    text += command.charAt(at);
    at++;
  }
  return { text, at: at + 1 };
}

/** A heredoc a line opens: the line that ends it, and whether `<<-` lets that line start with tabs. */
interface Heredoc {
  delimiter: string;
  tabs: boolean;
}

/** The heredoc whose `<<` is at `at`, with its delimiter's quoting taken off, and where its delimiter word ends; null for a `<<` with no word after it. */
function heredocStart(command: string, at: number): { heredoc: Heredoc | null; at: number } {
  at += 2;
  const tabs = command[at] === '-';
  if (tabs) at++;
  while (command[at] === ' ' || command[at] === '\t') at++;
  let delimiter = '';
  while (at < command.length && !/[\s;&|<>]/.test(command[at]!)) {
    if (command[at] !== "'" && command[at] !== '"' && command[at] !== '\\') delimiter += command.charAt(at);
    at++;
  }
  return { heredoc: delimiter ? { delimiter, tabs } : null, at };
}

/** Where the command goes on after the bodies of `heredocs`, which start at `at`, the line after the one that opened them, in the order they were opened. */
function pastHeredocs(command: string, at: number, heredocs: Heredoc[]): number {
  for (const { delimiter, tabs } of heredocs) {
    while (at < command.length) {
      const end = command.indexOf('\n', at);
      const line = command.slice(at, end === -1 ? command.length : end);
      at = end === -1 ? command.length : end + 1;
      if ((tabs ? line.replace(/^\t+/, '') : line) === delimiter) break;
    }
  }
  return at;
}
