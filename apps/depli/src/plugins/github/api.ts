import exec from '@/dev-tools/utils/process/exec';

import type { Env } from '../../core/plugin';

export interface GithubOptions {
  /** `owner/name` */
  repo?: string;
  /** A variable holding a token; `gh auth token` when unset or empty. */
  tokenEnv?: string;
  /** A local checkout of the repo — the SSH transport runs `git ls-remote` from it. */
  checkout?: string;
  /** The remote to ask over SSH; `origin` when unset. */
  remote?: string;
  /** e.g. https://api.github.com (the default) or a GitHub Enterprise API root. */
  apiUrl?: string;
  transports?: string[];
}

let ghToken: Promise<string | undefined> | undefined;

/** The token: the configured variable, else the `gh` CLI's login (asked once per process). */
export const githubToken = async (options: GithubOptions, env: Env) => {
  const fromEnv = options.tokenEnv ? env[options.tokenEnv] : undefined;
  if (fromEnv) return fromEnv;
  ghToken ??= exec(['gh', 'auth', 'token']).then((result) =>
    result.exitCode === 0 && result.stdout ? result.stdout.trim() : undefined,
  );
  return ghToken;
};

export class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** One GET (or GraphQL POST — a read) against the API. Never anything that writes. */
export const githubRequest = async <T>(
  options: GithubOptions,
  env: Env,
  path: string,
  body?: { query: string; variables?: Record<string, unknown> },
): Promise<T> => {
  const token = await githubToken(options, env);
  if (!token) throw new GithubError('no token — run gh auth login, or set tokenEnv', 401);
  const response = await fetch(`${options.apiUrl ?? 'https://api.github.com'}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new GithubError(`GitHub ${response.status} on ${path}`, response.status);
  const json = (await response.json()) as T & { errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new GithubError(json.errors[0]?.message ?? 'GraphQL error', 400);
  return json;
};

export const splitRepo = (repo: string | undefined) => {
  const [owner = '', name = ''] = (repo ?? '').split('/');
  return { owner, name };
};

/**
 * An Actions job's log as text — GitHub answers with a redirect to a short-lived URL, which
 * fetch follows. Not available while the job is still running, nor for a check that no
 * Actions job made: both come back as undefined.
 */
export const githubJobLog = async (options: GithubOptions, env: Env, jobId: string) => {
  const token = await githubToken(options, env);
  if (!token) throw new GithubError('no token — run gh auth login, or set tokenEnv', 401);
  const response = await fetch(
    `${options.apiUrl ?? 'https://api.github.com'}/repos/${options.repo}/actions/jobs/${jobId}/logs`,
    {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (response.status === 404 || response.status === 410) return undefined;
  if (!response.ok)
    throw new GithubError(`GitHub ${response.status} on job ${jobId} log`, response.status);
  return response.text();
};
