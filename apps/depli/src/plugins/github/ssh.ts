import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import exec from '@/dev-tools/utils/process/exec';

import { expandHome } from '../../config/project';
import type {
  Env,
  PluginContext,
  ProbeFact,
  ProbeFix,
  ProbeResult,
  TransportChoice,
} from '../../core/plugin';
import { type GithubOptions, githubRequest, githubToken, splitRepo } from './api';

/**
 * What the SSH transport goes through, as ssh itself would: the checkout's remote, the host alias
 * it names, what `ssh -G` resolves that to (host, agent, identity files), the agent's keys — and,
 * when a token is around, which of them are on the GitHub account. All of it is shown, so a
 * failure says which key got in and why that was the wrong one.
 */

const SSH_KEYS_URL = 'https://github.com/settings/keys';
const NEW_KEY_URL = 'https://github.com/settings/ssh/new';
const SAML_DOCS_URL =
  'https://docs.github.com/en/authentication/authenticating-with-saml-single-sign-on/authorizing-an-ssh-key-for-use-with-saml-single-sign-on';
const ONE_PASSWORD_AGENT_URL =
  'https://developer.1password.com/docs/ssh/agent/advanced/#ssh-agent-config-file';

export const SSH_GUIDE = {
  summary:
    'git over SSH from the checkout — the same way you push. It only sees branch heads, so it is the fallback when the API has no token; it needs a key on your GitHub account, authorized for the organisation if it uses SAML SSO.',
  steps: [
    'Have a key in your SSH agent (ssh-add -l lists them) or as an IdentityFile in ~/.ssh/config.',
    'Add its public half on GitHub: Settings → SSH and GPG keys → New SSH key.',
    'If the organisation uses SAML SSO: on that page, Configure SSO next to the key → Authorize.',
    'Several keys? Give the work host its own alias in ~/.ssh/config with IdentitiesOnly yes, or pick the key here.',
    'Test it: git ls-remote origin from the checkout.',
  ],
  links: [
    { label: 'GitHub SSH keys', url: SSH_KEYS_URL },
    { label: 'Authorizing a key for SAML SSO', url: SAML_DOCS_URL },
  ],
};

interface Remote {
  url: string;
  user?: string;
  host: string;
  path: string;
}

/** `git@host:owner/repo.git` or `ssh://git@host[:port]/owner/repo.git`; undefined for HTTPS. */
export const parseSshRemote = (url: string): Remote | undefined => {
  const scp = url.match(/^(?:([\w.-]+)@)?([\w.-]+):(?!\/\/)(.+)$/);
  if (scp?.[2] && scp[3]) return { url, user: scp[1], host: scp[2], path: scp[3] };
  const ssh = url.match(/^ssh:\/\/(?:([\w.-]+)@)?([\w.-]+)(?::\d+)?\/(.+)$/);
  if (ssh?.[2] && ssh[3]) return { url, user: ssh[1], host: ssh[2], path: ssh[3] };
  return undefined;
};

interface SshConfig {
  hostname: string;
  port?: string;
  user?: string;
  agent?: string;
  identityFiles: string[];
  identitiesOnly: boolean;
}

/** `ssh -G` — what ssh makes of a host after every Host/Match block. */
export const parseSshConfig = (text: string): SshConfig => {
  const config: SshConfig = { hostname: '', identityFiles: [], identitiesOnly: false };
  for (const line of text.split('\n')) {
    const [key = '', ...rest] = line.trim().split(' ');
    const value = rest.join(' ');
    if (key === 'hostname') config.hostname = value;
    else if (key === 'port') config.port = value;
    else if (key === 'user') config.user = value;
    else if (key === 'identityagent') config.agent = value;
    else if (key === 'identityfile') config.identityFiles.push(value);
    else if (key === 'identitiesonly') config.identitiesOnly = value === 'yes';
  }
  return config;
};

export interface SshKey {
  /** `SHA256:…` — what ssh -v prints and what the choice is stored as. */
  fingerprint: string;
  type: string;
  blob: string;
  /** The agent's comment, else the file's name. */
  name: string;
  inAgent: boolean;
  /** The IdentityFile it was read from. */
  file?: string;
  /** A private key is next to the file, so ssh can sign without the agent. */
  hasPrivate: boolean;
  /** Its title on the GitHub account the token belongs to; undefined when not there or unknown. */
  githubTitle?: string;
}

export const fingerprintOf = (blob: string) =>
  `SHA256:${createHash('sha256').update(Buffer.from(blob, 'base64')).digest('base64').replace(/=+$/, '')}`;

const parsePublicKey = (line: string) => {
  const [type = '', blob = '', ...comment] = line.trim().split(/\s+/);
  return blob ? { type, blob, comment: comment.join(' ') } : undefined;
};

const tildeHome = (path: string) => {
  const home = expandHome('~');
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
};

/** The agent's socket as ssh would use it: the config's IdentityAgent, else SSH_AUTH_SOCK. */
const agentSocket = (config: SshConfig, env: Env) => {
  const configured = config.agent && config.agent !== 'none' ? config.agent : undefined;
  if (configured === 'SSH_AUTH_SOCK') return env.SSH_AUTH_SOCK;
  return configured ? expandHome(configured) : config.agent === 'none' ? undefined : env.SSH_AUTH_SOCK;
};

const agentKeys = async (socket: string | undefined) => {
  if (!socket) return [];
  const result = await exec(['ssh-add', '-L'], { env: { ...process.env, SSH_AUTH_SOCK: socket } });
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split('\n')
    .map(parsePublicKey)
    .filter((key): key is NonNullable<typeof key> => Boolean(key));
};

const fileKey = (file: string) => {
  const path = expandHome(file);
  const pub = path.endsWith('.pub') ? path : `${path}.pub`;
  const priv = path.endsWith('.pub') ? path.slice(0, -4) : path;
  if (!existsSync(pub)) return undefined;
  const key = parsePublicKey(readFileSync(pub, 'utf8'));
  return key && { ...key, file, hasPrivate: existsSync(priv) };
};

interface GithubKeys {
  login: string;
  /** Undefined when the token may not list keys (no read:public_key scope). */
  titles?: Map<string, string>;
  at: number;
}
let githubKeysCache: Promise<GithubKeys | undefined> | undefined;
let githubKeysAt = 0;
let githubKeysToken: string | undefined;

/** The token's account and its SSH keys, by blob — asked at most every five minutes. */
const githubKeys = (options: GithubOptions, env: Env) => {
  return githubToken(options, env).then((token) => {
  //? Asked again for a new token (a sign-in), else at most every five minutes
  if (!githubKeysCache || token !== githubKeysToken || Date.now() - githubKeysAt > 5 * 60_000) {
    githubKeysAt = Date.now();
    githubKeysToken = token;
    githubKeysCache = (async () => {
      if (!token) return undefined;
      const [me, keys] = await Promise.all([
        githubRequest<{ login: string }>(options, env, '/user'),
        //? 404 without the read:public_key scope — gh's default login does not ask for it
        githubRequest<Array<{ key: string; title: string }>>(options, env, '/user/keys').catch(
          () => undefined,
        ),
      ]);
      if (!keys) return { login: me.login, at: Date.now() };
      const titles = new Map<string, string>();
      for (const key of keys) {
        const parsed = parsePublicKey(key.key);
        if (parsed) titles.set(parsed.blob, key.title);
      }
      return { login: me.login, titles, at: Date.now() };
    })().catch(() => undefined);
  }
  return githubKeysCache;
  });
};

export interface SshSetup {
  checkout: string;
  remoteName: string;
  remote?: Remote;
  /** The remote's URL when it is not SSH (HTTPS…). */
  otherUrl?: string;
  config?: SshConfig;
  socket?: string;
  keys: SshKey[];
  github?: { login: string; keysKnown: boolean };
  error?: string;
}

/** Everything ssh will go through for the checkout's remote — local reads only, and GitHub's keys. */
export const sshSetup = async ({ cwd, options, env }: PluginContext<GithubOptions>) => {
  const checkout = expandHome(options.checkout ?? cwd);
  const remoteName = options.remote ?? 'origin';
  const setup: SshSetup = { checkout, remoteName, keys: [] };
  const url = await exec(['git', '-C', checkout, 'remote', 'get-url', remoteName]);
  if (url.exitCode !== 0) {
    setup.error = url.stderr.split('\n')[0] || `no remote ${remoteName} in ${checkout}`;
    return setup;
  }
  setup.remote = parseSshRemote(url.stdout.trim());
  if (!setup.remote) {
    setup.otherUrl = url.stdout.trim();
    return setup;
  }
  const [resolved, github] = await Promise.all([
    exec(['ssh', '-G', ...(setup.remote.user ? ['-l', setup.remote.user] : []), setup.remote.host]),
    githubKeys(options, env),
  ]);
  setup.config = parseSshConfig(resolved.stdout);
  setup.socket = agentSocket(setup.config, env);
  setup.github = github && { login: github.login, keysKnown: Boolean(github.titles) };
  const keys = new Map<string, SshKey>();
  for (const key of await agentKeys(setup.socket)) {
    keys.set(key.blob, {
      fingerprint: fingerprintOf(key.blob),
      type: key.type,
      blob: key.blob,
      name: key.comment || key.type,
      inAgent: true,
      hasPrivate: false,
      githubTitle: github?.titles?.get(key.blob),
    });
  }
  for (const file of setup.config.identityFiles) {
    const key = fileKey(file);
    if (!key) continue;
    const known = keys.get(key.blob);
    if (known) {
      known.file = file;
      known.hasPrivate = key.hasPrivate;
      continue;
    }
    keys.set(key.blob, {
      fingerprint: fingerprintOf(key.blob),
      type: key.type,
      blob: key.blob,
      //? The file's name: a key file's comment is usually just an e-mail
      name: (file.split('/').pop() ?? file).replace(/\.pub$/, ''),
      inAgent: false,
      file,
      hasPrivate: key.hasPrivate,
      githubTitle: github?.titles?.get(key.blob),
    });
  }
  setup.keys = [...keys.values()];
  return setup;
};

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * The ssh command for git: never prompting, with only the picked key when there is one. ssh
 * needs a file for `-i`; an agent-only key gets its public half written to the temp folder,
 * which is enough — the agent signs with the matching private key.
 *
 * With a key picked, ~/.ssh/config is left out (`-F /dev/null`) and what `ssh -G` resolved is
 * passed instead: the config's own IdentityFile is offered *as well as* `-i` otherwise, and
 * GitHub would sign in with that one — a test of any key would pass on the config's key.
 */
export const sshCommand = (setup: SshSetup, choice: string | undefined, verbose = false) => {
  const parts = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  if (verbose) parts.push('-v');
  const key = choice ? setup.keys.find((entry) => entry.fingerprint === choice) : undefined;
  if (key) {
    let file = key.file && expandHome(key.file);
    if (!file || (!key.hasPrivate && !file.endsWith('.pub'))) {
      file = join(tmpdir(), `depli-${key.fingerprint.slice(7).replace(/[^\w]/g, '')}.pub`);
      writeFileSync(file, `${key.type} ${key.blob} ${key.name}\n`);
    }
    const config = setup.config;
    if (config?.hostname)
      parts.push(
        '-F',
        '/dev/null',
        '-o',
        `HostName=${config.hostname}`,
        ...(config.port ? ['-o', `Port=${config.port}`] : []),
        '-o',
        `User=${config.user ?? setup.remote?.user ?? 'git'}`,
        '-o',
        `IdentityAgent=${setup.socket ? quote(setup.socket) : 'none'}`,
      );
    parts.push('-o', 'IdentitiesOnly=yes', '-i', quote(file));
  }
  return parts.join(' ');
};

/** `git ls-remote --heads` through the given ssh command — what both the probe and the heads use. */
export const lsRemoteWith = (setup: SshSetup, ssh: string, refs: string[]) =>
  exec([
    'git',
    '-C',
    setup.checkout,
    '-c',
    `core.sshCommand=${ssh}`,
    'ls-remote',
    '--heads',
    setup.remoteName,
    ...refs,
  ]);

interface SshTrace {
  offered: string[];
  /**
   * Keys GitHub said it knows ("Server accepts key") — ssh still has to sign with them, which
   * fails for a key that is neither in the agent nor on disk.
   */
  known: string[];
  /** The key that signed in: the last known one, once ssh says it authenticated. */
  accepted?: string;
  authenticated: boolean;
  /** What ssh, git and GitHub said, without ssh's debug lines. */
  messages: string[];
}

/** What `ssh -v` printed: the keys it offered, the one that got in — by fingerprint. */
export const parseSshTrace = (stderr: string): SshTrace => {
  const trace: SshTrace = { offered: [], known: [], authenticated: false, messages: [] };
  for (const line of stderr.split('\n')) {
    //? Logged at -v's own level, with or without a debug1: prefix depending on the OpenSSH
    if (/Authenticated to /.test(line)) {
      trace.authenticated = true;
      trace.accepted = trace.known.at(-1);
      continue;
    }
    if (!line.startsWith('debug')) {
      if (line.trim() && !/^(OpenSSH_|Pseudo-terminal|Transferred:|Bytes per second)/.test(line))
        trace.messages.push(line.trim());
      continue;
    }
    const fingerprint = line.match(/SHA256:[\w+/]+/)?.[0];
    if (/Offering public key:/.test(line) && fingerprint) {
      if (!trace.offered.includes(fingerprint)) trace.offered.push(fingerprint);
    }
    else if (/Server accepts key:/.test(line) && fingerprint) trace.known.push(fingerprint);
    else if (/Authenticated to /.test(line)) {
      trace.authenticated = true;
      trace.accepted = trace.known.at(-1);
    }
  }
  return trace;
};

const keyName = (key: SshKey | undefined, fingerprint?: string) =>
  key ? (key.githubTitle && key.githubTitle !== key.name ? `${key.name} ("${key.githubTitle}" on GitHub)` : key.name) : (fingerprint ?? 'a key');

/** One line per key: where it comes from and what GitHub knows of it. */
const keyDetail = (key: SshKey, setup: SshSetup) => {
  const where = [
    key.inAgent ? 'in agent' : 'not in agent',
    key.file ? `IdentityFile ${key.file}` : undefined,
    key.hasPrivate ? 'private key on disk' : undefined,
  ].filter(Boolean);
  const github = setup.github?.keysKnown
    ? key.githubTitle
      ? `on GitHub as "${key.githubTitle}"`
      : `not on ${setup.github.login}'s GitHub`
    : undefined;
  return [...where, github].filter(Boolean).join(' · ');
};

const keyTone = (key: SshKey, setup: SshSetup): TransportChoice['tone'] =>
  !key.inAgent && !key.hasPrivate
    ? 'warn'
    : setup.github?.keysKnown && !key.githubTitle
      ? 'warn'
      : 'info';

/**
 * The keys worth picking for GitHub: those on the account and the host's IdentityFile. Without a
 * token there is no telling which are on GitHub, so then every key is listed.
 */
export const relevantKeys = (setup: SshSetup) =>
  setup.github?.keysKnown ? setup.keys.filter((key) => key.githubTitle || key.file) : setup.keys;

export const sshChoices = (setup: SshSetup): TransportChoice[] =>
  relevantKeys(setup).map((key) => ({
    id: key.fingerprint,
    label: key.name,
    detail: `${key.type.replace('ssh-', '')} ${key.fingerprint.slice(0, 18)}… · ${keyDetail(key, setup)}`,
    tone: keyTone(key, setup),
  }));

const setupFacts = (setup: SshSetup, choice: string | undefined): ProbeFact[] => {
  const facts: ProbeFact[] = [
    {
      label: 'remote',
      value: `${setup.remoteName} = ${setup.remote?.url ?? setup.otherUrl ?? '?'}  (in ${tildeHome(setup.checkout)})`,
    },
  ];
  const hidden = setup.keys.filter((key) => !relevantKeys(setup).includes(key));
  if (setup.remote && setup.config) {
    const alias = setup.remote.host !== setup.config.hostname;
    facts.push({
      label: 'host',
      value: `${alias ? `${setup.remote.host} → ` : ''}${setup.config.user ?? setup.remote.user ?? 'git'}@${setup.config.hostname}${alias ? '  (alias from ~/.ssh/config)' : ''}`,
    });
    facts.push({
      label: 'agent',
      value: setup.socket
        ? `${tildeHome(setup.socket)} · ${setup.keys.filter((key) => key.inAgent).length} key(s)`
        : 'none — only key files',
      tone: setup.socket ? undefined : 'warn',
    });
    if (setup.config.identityFiles.length)
      facts.push({
        label: 'config',
        value: `IdentityFile ${setup.config.identityFiles.join(', ')} · IdentitiesOnly ${setup.config.identitiesOnly ? 'yes' : 'no (the agent may offer its other keys first)'}`,
      });
    if (setup.github && !setup.github.keysKnown)
      facts.push({
        label: 'github',
        value: `cannot tell which keys are on ${setup.github.login}'s GitHub — the token lacks read:public_key (Sign in again adds it), so every agent key is listed`,
        tone: 'warn',
      });
    if (hidden.length)
      facts.push({
        label: 'skipped',
        value: `${hidden.map((key) => key.name).join(', ')} — in the agent but not on ${setup.github?.login}'s GitHub, so not listed to pick`,
      });
    const picked = choice && setup.keys.find((key) => key.fingerprint === choice);
    facts.push({
      label: 'using',
      value: picked
        ? `${keyName(picked)} only (picked here)`
        : choice
          ? `picked key ${choice.slice(0, 18)}… is gone — ssh config decides`
          : 'whatever ssh config offers, in its order',
      tone: choice && !picked ? 'warn' : undefined,
    });
  }
  return facts;
};

const orgOf = (options: GithubOptions, message: string) =>
  message.match(/The '([^']+)' organi[sz]ation/)?.[1] ?? splitRepo(options.repo).owner;

/** What a failed ls-remote means, from what ssh and GitHub said — and the way out of it. */
const diagnose = (
  setup: SshSetup,
  trace: SshTrace,
  options: GithubOptions,
  choice: string | undefined,
): { detail: string; fix: ProbeFix } => {
  const text = trace.messages.join('\n');
  const accepted = setup.keys.find((key) => key.fingerprint === trace.accepted);
  const configKeys = setup.keys.filter((key) => key.file);
  const stranded = configKeys.filter((key) => !key.inAgent && !key.hasPrivate);
  const strandedStep = stranded.length
    ? [
        `${stranded.map((key) => key.name).join(', ')} is this host's IdentityFile but the agent (${tildeHome(setup.socket ?? 'none')}) does not hold it, and there is no private key on disk — so ssh cannot use it and falls back to the agent's other keys. Load it: in 1Password, allow its item in ~/.config/1Password/ssh/agent.toml; otherwise ssh-add the private key.`,
      ]
    : [];
  const links = [
    { label: 'GitHub SSH keys', url: SSH_KEYS_URL },
    { label: 'SAML SSO for SSH keys', url: SAML_DOCS_URL },
    ...(stranded.length ? [{ label: '1Password agent.toml', url: ONE_PASSWORD_AGENT_URL }] : []),
  ];
  if (/SAML SSO/i.test(text)) {
    const org = orgOf(options, text);
    //? Keys ssh can sign with and GitHub knows — the stranded ones have their own step
    const others = setup.keys.filter(
      (key) => key !== accepted && key.githubTitle && (key.inAgent || key.hasPrivate),
    );
    return {
      detail: `${keyName(accepted, trace.accepted)} got in, but is not authorized for ${org}'s SAML SSO`,
      fix: {
        why: `GitHub accepted ${keyName(accepted, trace.accepted)}${setup.github ? ` (${setup.github.login})` : ''} — ssh offers keys in turn and stops at the first GitHub knows. That key is on your account, but ${org} enforces SAML single sign-on and the key was never authorized for it.`,
        steps: [
          `Authorize it: github.com/settings/keys → "${accepted?.githubTitle ?? accepted?.name ?? 'the key'}" → Configure SSO → Authorize next to ${org} (signs you in through ${org}'s SSO).`,
          ...strandedStep,
          ...(others.length
            ? [
                `Or use another of your keys, if it is authorized for ${org}: pick it below (${others.map((key) => key.name).join(', ')}) and test it.`,
              ]
            : []),
          ...(choice
            ? []
            : [
                `To fix git too, not only depli: in ~/.ssh/config, Host ${setup.remote?.host ?? 'github.com'} → IdentitiesOnly yes, so only its IdentityFile is offered.`,
              ]),
        ],
        links,
      },
    };
  }
  if (/Permission denied \(publickey\)/.test(text)) {
    //? GitHub knew a key, but ssh had nothing to sign with: not in the agent, no private key
    const unsigned = setup.keys.filter((key) => trace.known.includes(key.fingerprint));
    if (unsigned.length)
      return {
        detail: `GitHub knows ${unsigned.map((key) => key.name).join(', ')}, but ssh cannot sign with it`,
        fix: {
          why: `${unsigned.map((key) => keyName(key)).join(', ')} is on GitHub, but neither the agent (${tildeHome(setup.socket ?? 'none')}) holds it nor is its private key on disk — ssh has only the public half.`,
          steps: [
            'Load it into the agent: in 1Password, Settings → Developer → SSH agent, and allow its item (in ~/.config/1Password/ssh/agent.toml if you list vaults or items there); otherwise ssh-add the private key file.',
            'Check: ssh-add -l should list it, then press P.',
          ],
          links,
        },
      };
    return {
      detail: trace.offered.length
        ? `GitHub refused all ${trace.offered.length} key(s) offered`
        : 'no key was offered',
      fix: {
        why: trace.offered.length
          ? `ssh offered ${trace.offered.map((fp) => keyName(setup.keys.find((key) => key.fingerprint === fp), fp)).join(', ')} — none is on a GitHub account.`
          : `ssh had no key to offer for ${setup.remote?.host}: the agent is empty or not reachable, and no IdentityFile it can use.`,
        steps: [
          ...strandedStep,
          'Add the key you want to use on GitHub: Settings → SSH and GPG keys → New SSH key (paste the .pub).',
          'Then authorize it for the organisation if it uses SAML SSO (Configure SSO → Authorize).',
        ],
        links: [{ label: 'Add an SSH key', url: NEW_KEY_URL }, ...links],
      },
    };
  }
  if (/Repository not found|could not be found|access rights/i.test(text)) {
    return {
      detail: `${keyName(accepted, trace.accepted)} got in, but its account cannot see ${options.repo ?? 'the repo'}`,
      fix: {
        why: `GitHub accepted ${keyName(accepted, trace.accepted)}, but the account it belongs to has no access to ${options.repo ?? 'the repository'} (a personal key on a work repo?).`,
        steps: [
          ...strandedStep,
          'Pick the key of the account that has access, below — or ask for access to the repository.',
        ],
        links,
      },
    };
  }
  if (/Could not resolve hostname|Connection timed out|Network is unreachable/i.test(text)) {
    return {
      detail: trace.messages[0] ?? 'host unreachable',
      fix: {
        why: `ssh could not reach ${setup.remote?.host}.`,
        steps: [
          `Is "${setup.remote?.host}" a Host in ~/.ssh/config (or a real host)? ssh -G ${setup.remote?.host} shows what it resolves to.`,
          'Offline, or a firewall blocking port 22? GitHub also listens on ssh.github.com:443.',
        ],
      },
    };
  }
  return {
    detail: trace.messages.find((line) => /^(ERROR|fatal|error):/i.test(line)) ?? trace.messages[0] ?? 'git ls-remote failed',
    fix: { steps: [...strandedStep, 'Run git ls-remote in the checkout to see the whole message.'], links },
  };
};

/**
 * The SSH transport's probe: ls-remote a ref that does not exist, through `ssh -v`, so it costs
 * one round trip and says which key got in.
 */
export const probeSsh = async (context: PluginContext<GithubOptions>): Promise<ProbeResult> => {
  const setup = await sshSetup(context);
  const choices = sshChoices(setup);
  const facts = setupFacts(setup, context.choice);
  if (setup.error) return { ok: false, detail: setup.error, facts };
  if (!setup.remote)
    return {
      ok: false,
      detail: `${setup.remoteName} is not an SSH remote — SSH is not used here`,
      facts,
      fix: {
        why: `${setup.remoteName} is ${setup.otherUrl}: git reaches GitHub over HTTPS, not SSH.`,
        steps: [
          'Nothing to do if the API connects — it covers more than SSH would.',
          `To use SSH: git -C ${tildeHome(setup.checkout)} remote set-url ${setup.remoteName} git@github.com:${context.options.repo ?? 'owner/repo'}.git`,
        ],
      },
    };
  const result = await lsRemoteWith(setup, sshCommand(setup, context.choice, true), [
    'HEAD-does-not-exist',
  ]);
  const trace = parseSshTrace(result.stderr);
  const accepted = setup.keys.find((key) => key.fingerprint === trace.accepted);
  if (trace.offered.length)
    facts.push({
      label: 'offered',
      value: trace.offered
        .map((fp) => {
          const key = setup.keys.find((entry) => entry.fingerprint === fp);
          const mark =
            fp === trace.accepted
              ? ' ✓ in'
              : trace.known.includes(fp)
                ? ' ⚠ known, could not sign'
                : ' ✗ unknown';
          return `${key?.name ?? fp.slice(0, 18)}${mark}`;
        })
        .join(' → '),
    });
  if (trace.accepted)
    facts.push({
      label: 'accepted',
      value: keyName(accepted, trace.accepted),
      tone: result.exitCode === 0 ? 'ok' : 'warn',
    });
  //? Belt and braces: a picked key passes only if it is the one that got in
  if (result.exitCode === 0 && context.choice && trace.accepted && trace.accepted !== context.choice)
    return {
      ok: false,
      detail: `another key got in (${accepted?.name ?? trace.accepted}) — not this one`,
      facts,
      choices,
    };
  if (result.exitCode === 0)
    return {
      ok: true,
      detail: `git ls-remote works${accepted ? ` with ${accepted.name}` : ''}`,
      identity: accepted?.githubTitle && setup.github ? setup.github.login : undefined,
      facts,
      choices,
    };
  const { detail, fix } = diagnose(setup, trace, context.options, context.choice);
  return { ok: false, detail, facts, fix, choices };
};

/** The ssh command the heads are read with — the picked key, quiet. */
export const headsSshCommand = async (context: PluginContext<GithubOptions>) => {
  if (!context.choice) return undefined;
  const setup = await sshSetup(context);
  return setup.remote ? sshCommand(setup, context.choice) : undefined;
};
