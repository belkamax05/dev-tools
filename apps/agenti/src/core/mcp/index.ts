import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { IdeDefinition } from '../ides';
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
 * folder; `config/mcp_config.json` second because that is where
 * shulker-controller and dfs-fe-internal already keep theirs, and a repo that
 * adopts this tool should not have to move a file to do it.
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

/** The IDE's own config, or undefined for an IDE with no MCP support here. */
export const readTargetMcp = (root: string, ide: IdeDefinition): McpFile | undefined =>
  ide.mcp ? readMcpFile(ide.mcp.path(root), ide.mcp.key) : undefined;

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
 * Same name shulker-controller and dfs-fe-internal use, and expected to be
 * git-ignored there.
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
 * { "requiredEnv": { "dfs-jira": ["JIRA_PERSONAL_TOKEN"] }, "mcpServers": { … } }
 * ```
 *
 * That replaces shulker-controller's hard-coded server-to-token table, which
 * only ever knew about two dfs servers.
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

export default buildComparisons;
