import git, { failure } from '../run';
import type { OperationResult } from '../status';

export interface Commit {
  hash: string;
  short: string;
  author: string;
  when: string;
  subject: string;
  refs: string;
  /** The graph lanes drawn to the left of this commit, when the log was read with a graph. */
  graph: string;
}

/** A graph line with no commit on it — lanes merging or forking between commits. */
export interface GraphLine {
  graph: string;
}

export type LogLine = ({ kind: 'commit' } & Commit) | ({ kind: 'graph' } & GraphLine);

const SEP = '\u001f';
const MARK = '\u001e';

/**
 * One page of history, newest first. With `graph`, git draws the lanes and
 * every line — including the lanes-only ones between commits — comes back in
 * order; each commit's own line is found by the marker its format starts with.
 */
export const getLog = async (
  root: string,
  { skip = 0, limit = 100, graph = false, all = false } = {},
): Promise<LogLine[]> => {
  const format = `${MARK}${['%H', '%h', '%an', '%ar', '%s', '%D'].join(SEP)}`;
  const result = await git(
    [
      'log',
      `--skip=${skip}`,
      `--max-count=${limit}`,
      `--format=${format}`,
      ...(graph ? ['--graph'] : []),
      ...(all ? ['--all'] : []),
    ],
    root,
  );
  if (!result.ok) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.length)
    .map((line): LogLine => {
      const at = line.indexOf(MARK);
      if (at < 0) return { kind: 'graph', graph: line };
      const [hash = '', short = '', author = '', when = '', subject = '', refs = ''] = line
        .slice(at + 1)
        .split(SEP);
      return { kind: 'commit', graph: line.slice(0, at), hash, short, author, when, subject, refs };
    });
};

export interface CommitDetail {
  hash: string;
  author: string;
  date: string;
  subject: string;
  body: string;
  /** `git show --stat` lines: which files, how much. */
  stat: string[];
}

export const getCommitDetail = async (
  root: string,
  hash: string,
): Promise<CommitDetail | undefined> => {
  const result = await git(
    [
      'show',
      '--stat',
      '--no-color',
      `--format=%H${SEP}%an <%ae>${SEP}%ad${SEP}%s${SEP}%b${MARK}`,
      hash,
    ],
    root,
  );
  if (!result.ok) return undefined;
  const [meta = '', stat = ''] = result.stdout.split(MARK);
  const [full = '', author = '', date = '', subject = '', body = ''] = meta.split(SEP);
  return {
    hash: full,
    author,
    date,
    subject,
    body: body.trim(),
    stat: stat.split('\n').filter(Boolean),
  };
};

export const getCommitDiff = async (root: string, hash: string): Promise<string> =>
  (await git(['show', '--format=', '--no-color', hash], root)).stdout;

const result = (
  outcome: Awaited<ReturnType<typeof git>>,
  success: string,
  fallback: string,
): OperationResult =>
  outcome.ok ? { ok: true, message: success } : { ok: false, message: failure(outcome, fallback) };

export const cherryPick = async (root: string, hash: string) =>
  result(
    await git(['cherry-pick', hash], root),
    `Cherry-picked ${hash.slice(0, 7)}`,
    'cherry-pick stopped',
  );

//? --no-edit: the default "Revert ..." message; an editor here would hang the TUI
export const revertCommit = async (root: string, hash: string) =>
  result(
    await git(['revert', '--no-edit', hash], root),
    `Reverted ${hash.slice(0, 7)}`,
    'revert stopped',
  );

export const checkoutDetached = async (root: string, hash: string) =>
  result(
    await git(['switch', '--detach', hash], root),
    `HEAD is now at ${hash.slice(0, 7)} (detached)`,
    'could not check it out',
  );

export const branchAt = async (root: string, name: string, hash: string) =>
  result(
    await git(['branch', name.trim(), hash], root),
    `Created ${name.trim()} at ${hash.slice(0, 7)}`,
    'could not create the branch',
  );

export default getLog;
