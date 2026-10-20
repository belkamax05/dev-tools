import type { HistoryRun, JobHistory, PluginContext } from '../../core/plugin';
import { type GithubOptions, githubRequest } from './api';

/** Commits read per branch — enough to find what an env runs among the newest ones. */
export const COMMITS_READ = 30;

export interface CommitResponse {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: { name?: string; date?: string };
    committer?: { date?: string };
  };
  author: { login?: string; avatar_url?: string } | null;
}

/** A commit as a history run: the short SHA, when, who, and its first line as the detail. */
export const commitRun = (commit: CommitResponse, branch: string): HistoryRun => {
  const date = commit.commit.committer?.date ?? commit.commit.author?.date;
  return {
    id: commit.sha,
    label: commit.sha.slice(0, 8),
    state: 'success',
    at: date ? Date.parse(date) : undefined,
    url: commit.html_url,
    branch,
    sha: commit.sha,
    detail: commit.commit.message.split('\n')[0],
    actor: {
      login: commit.author?.login ?? commit.commit.author?.name ?? 'unknown',
      name: commit.commit.author?.name,
      avatarUrl: commit.author?.avatar_url,
    },
  };
};

/** The branch's newest commits, newest first — the push step's history for one branch. */
export const readBranchHistory = async (
  { options, env, connection }: PluginContext<GithubOptions>,
  branch: string,
): Promise<JobHistory[]> => {
  if (connection?.transport === 'ssh')
    throw new Error('Commit history needs the API transport — SSH sees branch heads only');
  const commits = await githubRequest<CommitResponse[]>(
    options,
    env,
    `/repos/${options.repo}/commits?sha=${encodeURIComponent(branch)}&per_page=${COMMITS_READ}`,
  );
  return [
    {
      job: branch,
      url:
        options.repo && !options.apiUrl
          ? `https://github.com/${options.repo}/commits/${encodeURIComponent(branch)}`
          : undefined,
      relation: `commits on ${branch}`,
      runs: commits.map((commit) => commitRun(commit, branch)),
    },
  ];
};
