import exec from '@/dev-tools/utils/process/exec';

import type {
  Env,
  LatestRun,
  LogChunk,
  PluginContext,
  ProbeFact,
  ProbeResult,
  StepInput,
  StepRun,
  StepStatus,
} from '../../core/plugin';
import { fillTemplate } from '../../core/plugin';
import { type JenkinsOptions, jenkinsAuth } from './api';
import { extractVersion } from './logVersion';

/**
 * Jenkins over its own SSH server — the Jenkins CLI, `ssh -p <port> <user>@<host> <command>`,
 * signed in with a key from the user's profile (Security → SSH Public Keys). Read-only and
 * limited: the CLI has no build history, parameters or timings, so a step reads only its job's
 * last build from the console (`Finished: SUCCESS`, the version line) and cannot match it to a
 * branch. Triggers stay with the API.
 */

const DOCS_URL = 'https://www.jenkins.io/doc/book/managing/cli/#ssh';

/** `host:port` — the config's `sshEndpoint`, else what Jenkins announces in X-SSH-Endpoint. */
export const sshEndpoint = async (options: JenkinsOptions, env: Env) => {
  if (options.sshEndpoint) return { endpoint: options.sshEndpoint, from: 'depli.config.ts' };
  const auth = jenkinsAuth(options, env);
  const response = await fetch(`${options.url}/`, {
    headers: auth ? { authorization: auth } : {},
    signal: AbortSignal.timeout(6_000),
  });
  const endpoint = response.headers.get('x-ssh-endpoint') ?? undefined;
  return { endpoint, from: 'X-SSH-Endpoint', response, auth };
};

const splitEndpoint = (endpoint: string) => {
  const at = endpoint.lastIndexOf(':');
  return at > 0
    ? { host: endpoint.slice(0, at), port: endpoint.slice(at + 1) }
    : { host: endpoint, port: '22' };
};

/** One Jenkins CLI command over SSH — never prompting; the user is the API's user. */
export const jenkinsCli = async (
  options: JenkinsOptions,
  env: Env,
  endpoint: string,
  args: string[],
) => {
  const { host, port } = splitEndpoint(endpoint);
  const user = options.userEnv ? env[options.userEnv] : undefined;
  return exec([
    'ssh',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=8',
    '-p',
    port,
    ...(user ? ['-l', user] : []),
    host,
    ...args,
  ]);
};

const lastLine = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? '';

let endpointCache: { at: number; endpoint?: string } | undefined;
const cachedEndpoint = async (options: JenkinsOptions, env: Env) => {
  if (!endpointCache || Date.now() - endpointCache.at > 60_000)
    endpointCache = { at: Date.now(), endpoint: (await sshEndpoint(options, env)).endpoint };
  if (!endpointCache.endpoint) throw new Error('Jenkins announces no SSH endpoint');
  return endpointCache.endpoint;
};

export const probeJenkinsSsh = async ({
  options,
  env,
}: PluginContext<JenkinsOptions>): Promise<ProbeResult> => {
  const facts: ProbeFact[] = [];
  const adminFix = {
    why: 'Your key in Jenkins is half of it: the "SSH Public Keys" field comes with Jenkins\' SSH module and is always there, whether or not the SSH server runs. The server is off — no SSH endpoint announced, no SSH section on its CLI page. That is a setting only an admin can change, and with Jenkins behind a proxy (Cloudflare) its SSH port must be exposed there too.',
    steps: [
      'Ask a Jenkins admin: Manage Jenkins → Security → SSH Server → Fixed port, then Save — and expose that port through the proxy in front of Jenkins.',
      'Your key goes in your profile (Security → SSH Public Keys) — and in your SSH agent.',
      'If the port is reachable under another name than Jenkins\' own, set sshEndpoint: "host:port" for this provider in depli.config.ts.',
      'Even then it is a limited fallback: the last build of each job, read-only — history, parameters, timings and triggers need the API.',
    ],
    links: [{ label: 'Jenkins CLI over SSH', url: DOCS_URL }],
  };
  let found: Awaited<ReturnType<typeof sshEndpoint>>;
  try {
    found = await sshEndpoint(options, env);
  } catch (error) {
    return { ok: false, detail: (error as Error).message, facts };
  }
  facts.push({
    label: 'endpoint',
    value: found.endpoint ? `${found.endpoint} (from ${found.from})` : `none announced by ${options.url}`,
    tone: found.endpoint ? 'ok' : 'warn',
  });
  if (!found.endpoint) {
    const { response, auth } = found;
    facts.push({
      label: 'checked',
      value: `${options.url}/ ${auth ? 'signed in' : 'anonymously (no credentials)'} → ${response?.status}`,
    });
    //? The other signs, signed in: the CLI page lists an ssh command when the server runs, and
    //? the profile shows whether a key is already there
    if (auth && response?.ok) {
      const [cli, security] = await Promise.all(
        ['/cli/', '/me/security/'].map((path) =>
          fetch(`${options.url}${path}`, {
            headers: { authorization: auth },
            signal: AbortSignal.timeout(6_000),
          })
            .then((page) => (page.ok ? page.text() : ''))
            .catch(() => ''),
        ),
      );
      const cliSsh = /\bssh\b/i.test((cli ?? '').replace(/<[^>]+>/g, ' '));
      facts.push({
        label: 'cli page',
        value: cliSsh ? 'mentions SSH' : 'no SSH section — the SSH server is not running',
        tone: cliSsh ? 'ok' : 'warn',
      });
      const keys = (security ?? '').match(/ssh-(rsa|ed25519|ecdsa)\s+AAAA/g)?.length ?? 0;
      facts.push({
        label: 'your keys',
        value: keys ? `${keys} SSH key(s) in your Jenkins profile` : 'no SSH key in your Jenkins profile',
        tone: keys ? 'ok' : undefined,
      });
      const proxy = response.headers.get('server');
      if (proxy && !/jetty|jenkins/i.test(proxy))
        facts.push({ label: 'via', value: `${proxy} in front of Jenkins — only HTTPS is passed through` });
      return { ok: false, detail: 'SSH server is off on this Jenkins (checked signed in)', facts, fix: adminFix };
    }
    return {
      ok: false,
      detail: `could not tell — ${options.url} answered ${response?.status} without credentials`,
      facts,
      fix: {
        why: 'Jenkins only sends its SSH endpoint on pages you may see; without credentials it refused first.',
        steps: ['Set up the API transport (user + token) and press P — the check then runs signed in.'],
      },
    };
  }
  const user = options.userEnv ? env[options.userEnv] : undefined;
  facts.push({ label: 'user', value: user ?? `$${options.userEnv ?? 'userEnv'} not set — ssh's own default` });
  const result = await jenkinsCli(options, env, found.endpoint, ['who-am-i']);
  const said = `${result.stdout}\n${result.stderr}`;
  const identity = said.match(/Authenticated as:\s*(.+)/)?.[1]?.trim();
  if (result.exitCode === 0 && identity && !/anonymous/i.test(identity))
    return { ok: true, detail: `Jenkins CLI over SSH works`, identity, facts };
  return {
    ok: false,
    detail: lastLine(result.stderr) || lastLine(result.stdout) || `ssh exited ${result.exitCode}`,
    facts,
    fix: {
      why: /Permission denied/i.test(said)
        ? 'Jenkins refused every key ssh offered: none of them is in your Jenkins profile.'
        : /timed out|refused|resolve/i.test(said)
          ? `Nothing answers SSH at ${found.endpoint} — the port is not reachable from here (proxy, firewall, VPN).`
          : undefined,
      steps: [
        'Paste the public key you use into your Jenkins profile: Security → SSH Public Keys.',
        'Make sure that key is in your SSH agent: ssh-add -l lists it.',
        `Test by hand: ssh -p ${splitEndpoint(found.endpoint).port} ${user ?? '<you>'}@${splitEndpoint(found.endpoint).host} who-am-i`,
      ],
      links: [{ label: 'Jenkins CLI over SSH', url: DOCS_URL }],
    },
  };
};

interface JobOptions {
  job: string;
  versionFromLog?: RegExp;
}

/** The last build of the job, as far as its console says: how it finished, what it produced. */
const lastBuild = async (options: JenkinsOptions, env: Env, input: StepInput) => {
  const step = input.step as unknown as JobOptions;
  const job = fillTemplate(step.job, input);
  const endpoint = await cachedEndpoint(options, env);
  const result = await jenkinsCli(options, env, endpoint, ['console', job]);
  if (result.exitCode !== 0) {
    const message = lastLine(result.stderr) || `console ${job} failed`;
    return { job, missing: /No such job/i.test(message), error: message };
  }
  const finished = result.stdout.match(/^Finished: (\w+)/m)?.[1];
  const version = step.versionFromLog ? extractVersion(result.stdout, step.versionFromLog) : undefined;
  return { job, finished, version, log: result.stdout };
};

const LIMIT_NOTE =
  'Over SSH (the Jenkins CLI) only the job\'s last build is read — not matched to the branch, no history, parameters or timings. Use the API for those.';

export const sshJobStatus = async (
  { options, env }: PluginContext<JenkinsOptions>,
  input: StepInput,
): Promise<StepStatus> => {
  const build = await lastBuild(options, env, input);
  if ('error' in build)
    return build.missing
      ? { state: 'missing', summary: `no job ${build.job}` }
      : { state: 'error', summary: build.error ?? 'Jenkins CLI failed', notes: [LIMIT_NOTE] };
  return {
    state: !build.finished ? 'running' : build.finished === 'SUCCESS' ? 'done' : 'failed',
    summary: `last build of ${build.job}: ${build.finished?.toLowerCase() ?? 'running'} (any branch — SSH cannot tell)`,
    ref: build.version ? { version: build.version, versionSource: 'log' } : undefined,
    outputs: build.version ? [{ label: 'version', value: build.version, note: 'from its log' }] : undefined,
    notes: [LIMIT_NOTE],
  };
};

export const sshJobLatest = async (
  { options, env }: PluginContext<JenkinsOptions>,
  input: StepInput,
): Promise<LatestRun> => {
  const build = await lastBuild(options, env, input);
  if ('error' in build)
    return { state: build.missing ? 'missing' : 'error', summary: build.error ?? 'Jenkins CLI failed' };
  return {
    state: !build.finished ? 'running' : build.finished === 'SUCCESS' ? 'done' : 'failed',
    summary: `last build ${build.finished?.toLowerCase() ?? 'running'} (over SSH)`,
    ref: build.version ? { version: build.version, versionSource: 'log' } : undefined,
  };
};

/** A build's console over SSH, sliced from `start` like the API's progressive text. */
export const sshJobLog = async (
  { options, env }: PluginContext<JenkinsOptions>,
  input: StepInput,
  run: StepRun,
  start: number,
): Promise<LogChunk> => {
  const job = fillTemplate((input.step as unknown as JobOptions).job, input);
  const endpoint = await cachedEndpoint(options, env);
  const result = await jenkinsCli(options, env, endpoint, ['console', job, run.id]);
  if (result.exitCode !== 0)
    return { text: '', next: start, more: false, unavailable: lastLine(result.stderr) };
  const finished = /^Finished: \w+/m.test(result.stdout);
  return { text: result.stdout.slice(start), next: result.stdout.length, more: !finished };
};
