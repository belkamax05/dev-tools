import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { homedir } from 'node:os';

import exec from '@/dev-tools/utils/process/exec';

import type { OperationResult } from '../agents';
import type { IdeMcpTarget } from '../ides';
import { AGENTS_DIR } from '../repo';

/**
 * One server as an IDE config holds it. Only the fields this tool reads are
 * named; anything else an IDE writes (`type`, `$typeName`, `registry`, …) is
 * carried through a copy untouched.
 */
export interface McpServerEntry {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Remote servers have a URL instead of a command. */
  url?: string;
  disabled?: boolean;
  [field: string]: unknown;
}

export type McpServers = Record<string, McpServerEntry>;

export interface McpFile {
  path: string;
  exists: boolean;
  /** The object under `key`. Empty when the file is missing or unreadable. */
  servers: McpServers;
  /** The whole parsed file, so a write keeps whatever else it holds. */
  raw: Record<string, unknown>;
  key: 'mcpServers' | 'servers';
  /** Set when the file exists but could not be parsed — shown, and never written over. */
  error?: string;
}

export type McpServerStatus = 'synced' | 'diff' | 'missing-in-target' | 'target-only';

export interface McpServerComparison {
  name: string;
  status: McpServerStatus;
  sourceEntry?: McpServerEntry;
  targetEntry?: McpServerEntry;
}

/**
 * Where a repository keeps its reference MCP config, in order of preference.
 *
 * `.agents/mcp_config.json` first, so everything agent-related lives in one
 * folder; `config/mcp_config.json` second, a common home for it in repositories
 * that kept a reference config before adopting this tool — they should not have
 * to move a file to do it.
 */
export const SOURCE_CANDIDATES = [
  join(AGENTS_DIR, 'mcp_config.json'),
  join('config', 'mcp_config.json'),
];

const readMcpFile = (path: string, key: McpFile['key']): McpFile => {
  if (!existsSync(path)) return { path, exists: false, servers: {}, raw: {}, key };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const servers = raw[key];
    return {
      path,
      exists: true,
      raw,
      key,
      servers: servers && typeof servers === 'object' ? (servers as McpServers) : {},
    };
  } catch (error) {
    return {
      path,
      exists: true,
      servers: {},
      raw: {},
      key,
      error: (error as Error).message,
    };
  }
};

/** The repository's reference config — the first candidate that exists, else where one would go. */
export const readSourceMcp = (root: string): McpFile => {
  const found = SOURCE_CANDIDATES.map((rel) => join(root, rel)).find((path) => existsSync(path));
  return readMcpFile(found ?? join(root, SOURCE_CANDIDATES[0] ?? ''), 'mcpServers');
};

/**
 * Replace the servers in `file`, keeping every other top-level key it had.
 *
 * @throws When the file exists but was unparseable — overwriting it would
 *   destroy whatever the user was in the middle of hand-editing
 */
export const writeServers = (file: McpFile, servers: McpServers): McpFile => {
  if (file.error) throw new Error(`${file.path} is not valid JSON — fix it by hand first`);
  const raw = { ...file.raw, [file.key]: servers };
  mkdirSync(dirname(file.path), { recursive: true });
  writeFileSync(file.path, `${JSON.stringify(raw, null, 2)}\n`);
  return { ...file, exists: true, raw, servers };
};

/** JSON with sorted keys, so two entries compare by content rather than key order. */
export const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Whether two entries configure the same server. `disabled` is ignored: turning
 * a server off in one IDE is a choice made there, not drift from the reference.
 */
export const sameEntry = (a: McpServerEntry, b: McpServerEntry): boolean => {
  const { disabled: _a, ...restA } = a;
  const { disabled: _b, ...restB } = b;
  return stableStringify(restA) === stableStringify(restB);
};

/** Field-by-field differences between two entries, `disabled` aside. */
export const getDiffFields = (source: McpServerEntry, target: McpServerEntry) => {
  const fields = new Set([...Object.keys(source), ...Object.keys(target)]);
  fields.delete('disabled');
  return [...fields]
    .filter((field) => stableStringify(source[field]) !== stableStringify(target[field]))
    .map((field) => ({
      field,
      source: source[field] === undefined ? '' : JSON.stringify(source[field]),
      target: target[field] === undefined ? '' : JSON.stringify(target[field]),
    }));
};

/** Every server in either config, reference servers first. */
export const buildComparisons = (source: McpServers, target: McpServers): McpServerComparison[] => [
  ...Object.entries(source).map(([name, sourceEntry]): McpServerComparison => {
    const targetEntry = target[name];
    if (!targetEntry) return { name, status: 'missing-in-target', sourceEntry };
    return {
      name,
      status: sameEntry(sourceEntry, targetEntry) ? 'synced' : 'diff',
      sourceEntry,
      targetEntry,
    };
  }),
  ...Object.entries(target)
    .filter(([name]) => !(name in source))
    .map(
      ([name, targetEntry]): McpServerComparison => ({
        name,
        status: 'target-only',
        targetEntry,
      }),
    ),
];

// ---------------------------------------------------------------------------
// Environment tokens
// ---------------------------------------------------------------------------

/**
 * The per-user secrets file MCP servers read tokens from, at the repo root.
 * Expected to be git-ignored — the Health tab checks that it is.
 */
export const ENV_FILE = '.env.user';

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

const placeholdersIn = (value: unknown, found: Set<string>) => {
  if (typeof value === 'string')
    for (const match of value.matchAll(PLACEHOLDER)) found.add(match[1] ?? '');
  else if (Array.isArray(value)) for (const item of value) placeholdersIn(item, found);
  else if (value && typeof value === 'object')
    for (const item of Object.values(value)) placeholdersIn(item, found);
};

export interface RequiredToken {
  key: string;
  /** Servers that need it. */
  servers: string[];
}

/**
 * The environment variables the reference servers need, and which servers need
 * each.
 *
 * Two ways to declare one. A `${NAME}` placeholder anywhere in a server's
 * `args`, `env` or `url` is picked up on its own. A server that reads a token
 * some other way — a wrapper script that loads `.env.user` itself — lists it in
 * a top-level `requiredEnv` map in the reference file:
 *
 * ```json
 * { "requiredEnv": { "issue-tracker": ["TRACKER_TOKEN"] }, "mcpServers": { … } }
 * ```
 *
 * Declared in the data rather than in code, so any repository can say what its
 * servers need without this tool knowing about them.
 */
export const getRequiredTokens = (source: McpFile): RequiredToken[] => {
  const byKey = new Map<string, Set<string>>();
  const add = (key: string, server: string) => {
    if (!byKey.has(key)) byKey.set(key, new Set());
    byKey.get(key)?.add(server);
  };

  for (const [server, entry] of Object.entries(source.servers)) {
    const found = new Set<string>();
    placeholdersIn([entry.args, entry.env, entry.url], found);
    for (const key of found) add(key, server);
  }

  const declared = source.raw.requiredEnv;
  if (declared && typeof declared === 'object') {
    for (const [server, keys] of Object.entries(declared as Record<string, unknown>)) {
      if (Array.isArray(keys))
        for (const key of keys) if (typeof key === 'string') add(key, server);
    }
  }

  return [...byKey.entries()]
    .map(([key, servers]) => ({ key, servers: [...servers].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

/** `KEY=value` lines of `.env.user`. Quotes around a value are dropped; comments skipped. */
export const readEnvFile = (root: string): Record<string, string> => {
  const path = join(root, ENV_FILE);
  if (!existsSync(path)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match?.[1]) continue;
    values[match[1]] = (match[2] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return values;
};

/** Set one key in `.env.user`, in place when it is already there, leaving every other line alone. */
export const setEnvValue = (root: string, key: string, value: string) => {
  const path = join(root, ENV_FILE);
  const lines = existsSync(path) ? readFileSync(path, 'utf-8').replace(/\n$/, '').split('\n') : [];
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
  let found = false;
  const next = lines.map((line) => {
    if (!pattern.test(line)) return line;
    found = true;
    return `${key}=${value}`;
  });
  if (!found) next.push(`${key}=${value}`);
  writeFileSync(path, `${next.join('\n')}\n`);
};

/** `${NAME}` placeholders filled in from `.env.user`, then the environment. Unknown ones are left as written. */
export const expandPlaceholders = <T>(value: T, env: Record<string, string | undefined>): T => {
  if (typeof value === 'string') {
    return value.replace(PLACEHOLDER, (whole, key: string) => env[key] ?? whole) as T;
  }
  if (Array.isArray(value)) return value.map((item) => expandPlaceholders(item, env)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, expandPlaceholders(v, env)]),
    ) as T;
  }
  return value;
};

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export interface McpTool {
  name: string;
  description?: string;
}

export interface McpToolsResult {
  tools: McpTool[];
  error?: string;
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`No answer within ${ms / 1000}s`)), ms).unref?.();
    }),
  ]);

/**
 * Start a server, ask it for its tools, and shut it down.
 *
 * The SDK is imported here rather than at the top so nothing but this call
 * pays for loading it.
 */
export const listServerTools = async (
  entry: McpServerEntry,
  root: string,
  timeoutMs = 10_000,
): Promise<McpToolsResult> => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const env = { ...process.env, ...readEnvFile(root) } as Record<string, string>;
  const expanded = expandPlaceholders(entry, env);
  const client = new Client({ name: 'agenti', version: '1.0.0' }, { capabilities: {} });

  try {
    if (expanded.url) {
      const { StreamableHTTPClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/streamableHttp.js'
      );
      await withTimeout(
        client.connect(new StreamableHTTPClientTransport(new URL(expanded.url))),
        timeoutMs,
      );
    } else if (expanded.command) {
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
      const transport = new StdioClientTransport({
        command: expanded.command,
        args: expanded.args ?? [],
        env: { ...env, ...(expanded.env ?? {}) },
        cwd: root,
        //? The default inherits stderr, and a server's startup chatter would be
        //? drawn straight over the TUI
        stderr: 'ignore',
      });
      await withTimeout(client.connect(transport), timeoutMs);
    } else {
      return {
        tools: [],
        error: 'Neither a command nor a url to start it with',
      };
    }

    const { tools } = await withTimeout(client.listTools(), timeoutMs);
    return {
      tools: tools.map(({ name, description }) => ({ name, description })),
    };
  } catch (error) {
    return { tools: [], error: (error as Error).message };
  } finally {
    await client.close().catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// IDE targets — files, and Claude Code's CLI-managed scopes
// ---------------------------------------------------------------------------

export interface McpTargetState {
  target: IdeMcpTarget;
  /** "project", "local" or "user" — who sees these servers. */
  scope: IdeMcpTarget['scope'];
  /** Where they live, for display: a file path, or `~/.claude.json` for Claude's own scopes. */
  location: string;
  exists: boolean;
  servers: McpServers;
  error?: string;
  /** Whether `disabled` on an entry means anything here — Claude Code's scopes have no such flag. */
  supportsDisabled: boolean;
  /** For a file target, the file as read, so writes keep what else it holds. */
  file?: McpFile;
}

/** `~/.claude.json`, where Claude Code keeps its local- and user-scope servers. */
export const claudeJsonPath = () => join(homedir(), '.claude.json');

const readClaudeJson = (): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(claudeJsonPath(), 'utf-8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

/** What an IDE has configured at one of its MCP scopes. */
export const readMcpTarget = (root: string, target: IdeMcpTarget): McpTargetState => {
  if (target.kind === 'file') {
    const file = readMcpFile(target.path(root), target.key);
    return {
      target,
      scope: target.scope,
      location: file.path,
      exists: file.exists,
      servers: file.servers,
      error: file.error,
      supportsDisabled: true,
      file,
    };
  }
  const json = readClaudeJson();
  const holder =
    target.scope === 'user'
      ? json
      : ((json?.projects as Record<string, Record<string, unknown>> | undefined)?.[root] ??
        undefined);
  const servers = (holder?.mcpServers as McpServers | undefined) ?? {};
  return {
    target,
    scope: target.scope,
    location: claudeJsonPath(),
    exists: Boolean(json),
    servers,
    supportsDisabled: false,
  };
};

/**
 * Add, replace (`entry`) or remove (`undefined`) one server at a target.
 *
 * A file is read-modified-written, keeping every other key. Claude Code's own
 * scopes go through its CLI — `claude mcp add-json` / `claude mcp remove` —
 * because `~/.claude.json` is rewritten by every running Claude Code, and a
 * write from here would race it.
 */
export const setMcpServer = async (
  root: string,
  state: McpTargetState,
  name: string,
  entry: McpServerEntry | undefined,
): Promise<OperationResult> => {
  if (state.target.kind === 'file') {
    if (!state.file) return { ok: false, message: 'Not a file target' };
    const servers = { ...state.servers };
    if (entry) servers[name] = entry;
    else delete servers[name];
    try {
      writeServers(state.file, servers);
      return { ok: true, message: entry ? `Saved ${name}` : `Removed ${name}` };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  const scope = state.target.scope;
  if (name in state.servers) {
    const removed = await exec(['claude', 'mcp', 'remove', '-s', scope, name], { cwd: root });
    if (removed.exitCode !== 0) return { ok: false, message: removed.stderr || removed.stdout };
  }
  if (!entry) return { ok: true, message: `Removed ${name} from Claude Code's ${scope} scope` };
  const { disabled: _off, ...json } = entry;
  const added = await exec(['claude', 'mcp', 'add-json', '-s', scope, name, JSON.stringify(json)], {
    cwd: root,
  });
  return added.exitCode === 0
    ? { ok: true, message: `Added ${name} to Claude Code's ${scope} scope` }
    : { ok: false, message: added.stderr || added.stdout || 'claude mcp add-json failed' };
};

// ---------------------------------------------------------------------------
// Claude Code's approval of project servers
// ---------------------------------------------------------------------------

export type ApprovalState = 'approved' | 'denied' | 'pending';

const readJson = (path: string): Record<string, unknown> => {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const localSettingsPath = (root: string) => join(root, '.claude', 'settings.local.json');

/**
 * Whether Claude Code will start each of a repository's `.mcp.json` servers.
 *
 * Claude Code asks once per server and remembers the answer; a server copied
 * into `.mcp.json` does nothing until someone says yes. The answers can come
 * from `enableAllProjectMcpServers`, `enabledMcpjsonServers` or
 * `disabledMcpjsonServers` in the shared or local settings, or from the choice
 * Claude Code stored for this project in `~/.claude.json` — later sources win.
 */
export const getMcpApprovals = (root: string, names: string[]): Record<string, ApprovalState> => {
  const project = (
    readClaudeJson()?.projects as Record<string, Record<string, unknown>> | undefined
  )?.[root];
  const sources = [
    project ?? {},
    readJson(join(root, '.claude', 'settings.json')),
    readJson(localSettingsPath(root)),
  ];
  const approvals: Record<string, ApprovalState> = {};
  for (const name of names) approvals[name] = 'pending';
  for (const source of sources) {
    if (source.enableAllProjectMcpServers === true)
      for (const name of names) approvals[name] = 'approved';
    for (const name of (source.enabledMcpjsonServers as string[] | undefined) ?? []) {
      if (name in approvals) approvals[name] = 'approved';
    }
    for (const name of (source.disabledMcpjsonServers as string[] | undefined) ?? []) {
      if (name in approvals) approvals[name] = 'denied';
    }
  }
  return approvals;
};

/**
 * Approve or deny a project server for this user, in `.claude/settings.local.json`
 * — the per-user settings file Claude Code reads, never committed — rather than
 * in `~/.claude.json`, which Claude Code owns.
 */
export const setMcpApproval = (root: string, name: string, approve: boolean): OperationResult => {
  const path = localSettingsPath(root);
  const settings = readJson(path);
  const enabled = new Set((settings.enabledMcpjsonServers as string[] | undefined) ?? []);
  const disabled = new Set((settings.disabledMcpjsonServers as string[] | undefined) ?? []);
  (approve ? enabled : disabled).add(name);
  (approve ? disabled : enabled).delete(name);
  settings.enabledMcpjsonServers = [...enabled].sort();
  settings.disabledMcpjsonServers = [...disabled].sort();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  return {
    ok: true,
    message: `${approve ? 'Approved' : 'Denied'} ${name} for Claude Code (settings.local.json)`,
  };
};

/**
 * Values in a shared MCP file that look like secrets written in plain text:
 * an `env` value, header or argument next to a key that says token, key,
 * secret or password, which is not a `${NAME}` placeholder.
 */
export const findLiteralSecrets = (servers: McpServers): string[] => {
  const found: string[] = [];
  const secretish = /token|secret|password|passwd|api[-_]?key|auth/i;
  for (const [name, entry] of Object.entries(servers)) {
    for (const [key, value] of Object.entries(entry.env ?? {})) {
      if (secretish.test(key) && value && !/^\$\{[^}]+\}$/.test(value))
        found.push(`${name}: env ${key}`);
    }
    const headers = (entry.headers as Record<string, string> | undefined) ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (secretish.test(key) && value && !value.includes('${'))
        found.push(`${name}: header ${key}`);
    }
  }
  return found;
};

export default buildComparisons;
