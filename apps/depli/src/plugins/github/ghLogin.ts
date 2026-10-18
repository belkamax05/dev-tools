import exec from '@/dev-tools/utils/process/exec';

import type { TransportSetup } from '../../core/plugin';
import { forgetGhToken, type GithubOptions, splitRepo } from './api';

/** The web host the API root belongs to — github.com, unless an Enterprise apiUrl says else. */
const hostOf = (options: GithubOptions) => {
  if (!options.apiUrl) return 'github.com';
  const url = new URL(options.apiUrl);
  return url.hostname.replace(/^api\./, '');
};

/**
 * `gh auth login` run by depli: the browser (device) flow, with gh's prompts answered by its
 * flags — so the person sees a code and a page to open, never a shell. Without a terminal gh
 * prints the one-time code and the device URL and waits until the browser side is done.
 */
export const ghLoginSetup: TransportSetup<GithubOptions> = {
  label: 'Sign in with the GitHub CLI',
  detail:
    'Runs gh auth login for you: a code to type on github.com, nothing to run in a shell. depli then reads its token with gh auth token.',
  steps: [
    'The device page opens in your browser (or use Open page below) — sign in to GitHub if asked.',
    'Type the code shown here (it is on your clipboard too) and Continue.',
    'Authorize GitHub CLI. If the organisation uses SAML SSO, press Authorize next to it on that page.',
    'Come back here — depli notices when it is done and probes again.',
  ],
  unavailable: async () => {
    const version = await exec(['gh', '--version']);
    return version.exitCode === 0
      ? undefined
      : 'The GitHub CLI (gh) is not installed — install it (nixpkgs: gh, or https://cli.github.com), then come back.';
  },
  start: ({ options }, onProgress) => {
    const host = hostOf(options);
    const org = splitRepo(options.repo).owner;
    onProgress({ state: 'running', message: `starting gh auth login for ${host}…` });
    //? The token before, to tell a real sign-in from gh exiting without saving one
    const before = exec(['gh', 'auth', 'token', '--hostname', host]).then((result) => result.stdout);
    const child = Bun.spawn(
      [
        'gh',
        'auth',
        'login',
        '--hostname',
        host,
        '--git-protocol',
        'ssh',
        '--web',
        '--clipboard',
        '--skip-ssh-key',
        //? Beyond gh's repo, read:org and gist: lets depli see which SSH keys are on GitHub
        '--scopes',
        'read:public_key',
      ],
      //? No terminal: gh asks nothing and prints the code; BROWSER=true stops it opening one
      //? itself — the app opens the page, so it is opened exactly once
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BROWSER: 'true' } },
    );
    let code: string | undefined;
    let url: string | undefined;
    let last = '';
    let cancelled = false;
    const read = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        const text = decoder.decode(chunk);
        for (const line of text.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
          last = line;
          code ??= line.match(/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/)?.[1];
          url ??= line.match(/https?:\/\/\S+\/login\/device\S*/)?.[0];
        }
        if (code && url)
          onProgress({
            state: 'waiting',
            message: `waiting for you to finish on ${host}${org ? ` — authorize ${org} there if it asks` : ''}`,
            code,
            url,
          });
      }
    };
    Promise.all([read(child.stdout), read(child.stderr), child.exited]).then(([, , exitCode]) => {
      if (cancelled) return onProgress({ state: 'failed', message: 'cancelled' });
      if (exitCode !== 0)
        return onProgress({ state: 'failed', message: last || `gh auth login exited ${exitCode}` });
      forgetGhToken();
      //? Said only once it is true: a new token saved, with the scopes GitHub granted
      Promise.all([before, exec(['gh', 'auth', 'token', '--hostname', host])]).then(
        async ([previous, after]) => {
          const token = after.stdout;
          if (!token || token === previous)
            return onProgress({
              state: 'failed',
              message: `gh finished but saved no new login${last ? ` — ${last}` : ''}`,
            });
          const response = await fetch(
            `${options.apiUrl ?? 'https://api.github.com'}/user`,
            { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
          ).catch(() => undefined);
          const login = response?.ok ? ((await response.json()) as { login: string }).login : undefined;
          const scopes = response?.headers.get('x-oauth-scopes');
          onProgress({
            state: 'done',
            message: `signed in to ${host}${login ? ` as ${login}` : ''}${scopes ? ` · scopes ${scopes}` : ''}`,
          });
        },
      );
    });
    return {
      cancel: () => {
        cancelled = true;
        child.kill();
      },
    };
  },
};
