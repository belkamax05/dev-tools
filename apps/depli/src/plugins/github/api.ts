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

/** Forget gh's token — after a login, so the next request asks gh again. */
export const forgetGhToken = () => {
  ghToken = undefined;
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

const TOKENS_URL = 'https://github.com/settings/tokens';
const APPS_URL = 'https://github.com/settings/applications';
const PAT_SSO_DOCS_URL =
  'https://docs.github.com/en/authentication/authenticating-with-saml-single-sign-on/authorizing-a-personal-access-token-for-use-with-saml-single-sign-on';

export const API_GUIDE = {
  summary:
    'The recommended way: GitHub\'s REST and GraphQL API with a token — everything depli shows for GitHub: commit times, checks, PRs, Actions runs. SSH only sees branch heads. Either of two token sources is enough.',
  steps: [
    'Easiest: Sign in with the GitHub CLI, below — depli runs gh auth login for you and reads its token with gh auth token.',
    'Or a personal access token: github.com/settings/tokens → classic with the repo scope, or fine-grained with read access to the repo; put it in a variable and name it as tokenEnv in depli.config.ts.',
    'If the organisation uses SAML SSO, the token must be authorized for it: Configure SSO → Authorize next to the token (for gh: it asks during login, or gh auth refresh).',
    'Then press P to probe again.',
  ],
  links: [
    { label: 'Personal access tokens', url: TOKENS_URL },
    { label: 'Authorizing a token for SAML SSO', url: PAT_SSO_DOCS_URL },
  ],
};

/** Where the token comes from, said so a person can find it: the variable, or gh's login. */
const tokenSourceFact = (options: GithubOptions, env: Env, token: string | undefined) => {
  if (options.tokenEnv && env[options.tokenEnv]) return `$${options.tokenEnv}`;
  const missing = options.tokenEnv ? `$${options.tokenEnv} is empty → ` : '';
  return token ? `${missing}gh auth token (the gh CLI's login)` : `${missing}gh auth token — gh not logged in`;
};

/**
 * The API transport's probe: the repo and who the token is, with the headers that explain a
 * failure — the token's scopes, and GitHub's SSO header when SAML is what stands in the way.
 */
export const probeApi = async (options: GithubOptions, env: Env) => {
  //? Asked afresh on every probe: a gh login (or logout) since the last one — in the app or in
  //? a shell — shows on the next probe, not after a restart. The requests in between reuse it
  forgetGhToken();
  const token = await githubToken(options, env);
  const base = options.apiUrl ?? 'https://api.github.com';
  const facts: Array<{ label: string; value: string; tone?: 'ok' | 'warn' | 'error' | 'info' }> = [
    { label: 'api', value: base },
    {
      label: 'token',
      value: tokenSourceFact(options, env, token),
      tone: token ? undefined : 'error',
    },
  ];
  if (!token)
    return {
      ok: false,
      detail: 'no token — gh not logged in and no tokenEnv',
      facts,
      fix: {
        why: options.tokenEnv
          ? `${options.tokenEnv} is not set, and the gh CLI has no login to fall back on.`
          : 'No tokenEnv in depli.config.ts, and the gh CLI has no login to fall back on.',
        steps: API_GUIDE.steps,
        links: API_GUIDE.links,
      },
    };
  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  let me: Response;
  let repo: Response;
  try {
    [me, repo] = await Promise.all([
      fetch(`${base}/user`, { headers, signal: AbortSignal.timeout(15_000) }),
      fetch(`${base}/repos/${options.repo}`, { headers, signal: AbortSignal.timeout(15_000) }),
    ]);
  } catch (error) {
    return { ok: false, detail: `unreachable — ${(error as Error).message}`, facts };
  }
  const login = me.ok ? ((await me.json()) as { login: string }).login : undefined;
  const scopes = me.headers.get('x-oauth-scopes');
  if (login) facts.push({ label: 'account', value: login });
  facts.push({
    label: 'scopes',
    value:
      scopes === null
        ? 'none listed (a fine-grained token: its access is set per repo)'
        : scopes || 'none',
  });
  if (repo.ok) {
    facts.push({ label: 'repo', value: `${options.repo} — readable`, tone: 'ok' });
    return { ok: true, detail: `can read ${options.repo}`, identity: login, facts };
  }
  const sso = repo.headers.get('x-github-sso');
  const ssoUrl = sso?.match(/url=(\S+)/)?.[1];
  const { owner } = splitRepo(options.repo);
  facts.push({ label: 'repo', value: `${options.repo} — GitHub ${repo.status}`, tone: 'error' });
  if (!me.ok)
    return {
      ok: false,
      detail: `token refused (GitHub ${me.status})`,
      facts,
      fix: {
        why: 'GitHub does not accept the token: expired, revoked, or mistyped.',
        steps: [
          options.tokenEnv && env[options.tokenEnv]
            ? `Make a new token and put it in ${options.tokenEnv}.`
            : 'Log in again: gh auth login (or gh auth refresh).',
        ],
        links: [{ label: 'Personal access tokens', url: TOKENS_URL }],
      },
    };
  if (sso)
    return {
      ok: false,
      detail: `token not authorized for ${owner}'s SAML SSO`,
      facts,
      fix: {
        why: `${owner} enforces SAML single sign-on, and this token (${login}) has not been authorized for it.`,
        steps: [
          ssoUrl
            ? 'Open the authorization link below and sign in through the organisation\'s SSO.'
            : 'github.com/settings/tokens → Configure SSO next to the token → Authorize.',
          'For gh\'s login: github.com/settings/applications → GitHub CLI → grant the organisation, or gh auth refresh.',
        ],
        links: [
          ...(ssoUrl ? [{ label: `Authorize for ${owner}`, url: ssoUrl }] : []),
          { label: 'Authorized OAuth apps', url: APPS_URL },
          { label: 'Authorizing a token for SAML SSO', url: PAT_SSO_DOCS_URL },
        ],
      },
    };
  return {
    ok: false,
    detail:
      repo.status === 404
        ? `${login ?? 'the token'} cannot see ${options.repo}`
        : `GitHub ${repo.status} on ${options.repo}`,
    facts,
    fix: {
      why:
        repo.status === 404
          ? `GitHub answers 404 for a private repo the token cannot read: the account lacks access, or the token lacks the repo scope.`
          : undefined,
      steps: [
        'A classic token needs the repo scope; a fine-grained one needs this repository with Contents: read.',
        `Check ${login ?? 'the account'} is a member with access to ${options.repo}.`,
      ],
      links: [{ label: 'Personal access tokens', url: TOKENS_URL }],
    },
  };
};
