import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { loadProjectConfigs, type ProjectConfig } from '../../config/project';
import { configStore, type EnviConfig } from '../../config/settings';
import { readEnvFile } from '../envFile';
import { type DotenvError, evaluate, expandText, parseDotenv } from '../parse';
import { launchEnv, shellBase } from '../shell';

export type LayerKind = 'user' | 'file' | 'project';

export type LayerStatus = 'loaded' | 'missing' | 'disabled' | 'error';

/** One source of variables, in the order they are applied. */
export interface Layer {
  id: string;
  kind: LayerKind;
  /** `.env`, `your vars`, `env.config.ts (apps/web)`. */
  label: string;
  path?: string;
  /** For a file: the name as its list wrote it — what `disabled` and the dashboard match on. */
  written?: string;
  /** For a file: whose list named it — `config` (yours) or an `env.config.ts`'s path. */
  listedBy?: string;
  status: LayerStatus;
  /** What switched it off: `config` or an `env.config.ts`'s path. */
  disabledBy?: string;
  /** The evaluated values, in file order. Empty unless `loaded`. */
  entries: { key: string; value: string; line?: number }[];
  errors: DotenvError[];
  error?: string;
}

export interface VarSource {
  layerId: string;
  kind: LayerKind;
  label: string;
  path?: string;
  line?: number;
  value: string;
}

/**
 * - `new`: envi sets it; the shell does not have it.
 * - `changed`: envi replaces the shell's value (only with `override`).
 * - `same`: envi would set what the shell already has.
 * - `kept`: the shell's own value wins — `override` is off and it was already exported.
 */
export type VarStatus = 'new' | 'changed' | 'same' | 'kept';

export interface ResolvedVar {
  key: string;
  /** What a command run through envi sees. */
  value: string;
  /** The layer whose value envi ends up with (shadowed by the shell when `kept`). */
  source: VarSource;
  /** Earlier layers that set it too and lost, oldest first. */
  shadowed: VarSource[];
  /** The shell's value, before envi. */
  shell?: string;
  status: VarStatus;
}

export interface Resolution {
  cwd: string;
  root: string;
  override: boolean;
  /** The shell's environment with anything envi applied to it before taken back out. */
  base: Record<string, string>;
  /** `base` with envi's layers applied — the environment `envi run` hands a command. */
  env: Record<string, string>;
  /** Every variable an envi layer sets, sorted by key. */
  vars: ResolvedVar[];
  layers: Layer[];
  projects: ProjectConfig[];
  /** Names that must be set: every config's `required`, plus the keys of `.env.example`. */
  required: { key: string; from: string }[];
  missing: { key: string; from: string }[];
  /** The template file the required keys partly came from. */
  example?: string;
}

export interface ResolveOptions {
  cwd?: string;
  /**
   * The environment to start from. Defaults to the one the process was launched with (see
   * `launchEnv`), with envi's own changes undone.
   */
  env?: Record<string, string | undefined>;
  /** Your config. Defaults to `~/.config/envi/config.json`; pass `false` to leave it out. */
  config?: EnviConfig | false;
  /** Skip every `env.config.ts`. */
  noProject?: boolean;
  override?: boolean;
}

export const EXAMPLE_NAMES = ['.env.example', '.env.sample', '.env.template', '.env.dist'];

export const expandHome = (path: string) =>
  path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;

const absolute = (base: string, path: string) => resolve(base, expandHome(path));

interface DisableRule {
  pattern: string;
  dir: string;
  by: string;
}

/** A rule without a slash is a name (matches in any folder); one with a slash is a path. */
export const matchesRule = (pattern: string, dir: string, path: string, written: string) =>
  /[\\/]/.test(pattern) || isAbsolute(pattern) || pattern.startsWith('~')
    ? absolute(dir, pattern) === path
    : pattern === written || pattern === basename(path);

const disabledBy = (path: string, written: string, rules: DisableRule[]): string | undefined =>
  rules.find((rule) => matchesRule(rule.pattern, rule.dir, path, written))?.by;

/**
 * Switch a file layer off in your config: by the name your list wrote it as (so `.env.user` is off
 * in every folder, the way it is listed), or by its full path when an `env.config.ts` listed it.
 */
export const disableFile = (config: EnviConfig, layer: Layer): EnviConfig => {
  const pattern = layer.listedBy === 'config' && layer.written ? layer.written : layer.path;
  if (!pattern || config.disabled.includes(pattern)) return config;
  return { ...config, disabled: [...config.disabled, pattern] };
};

/** Drop every rule of yours that switches `layer` off. One an `env.config.ts` set stays. */
export const enableFile = (config: EnviConfig, layer: Layer, cwd: string): EnviConfig => ({
  ...config,
  disabled: config.disabled.filter(
    (pattern) => !layer.path || !matchesRule(pattern, cwd, layer.path, layer.written ?? ''),
  ),
});

const shortPath = (path: string, cwd: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path.replace(homedir(), '~');

/**
 * Work out what envi would set here, and why.
 *
 * Layers apply in this order, a later one winning:
 *
 * 1. your own variables (`vars` in `config.json`) — under everything, so a project can override;
 * 2. the env files: your list (`.env`, `.env.user` by default), from `cwd`, then each
 *    `env.config.ts`'s `files`, root first, from that config's folder — minus any disabled;
 * 3. each `env.config.ts`'s `vars`, root first.
 *
 * Then the shell: a name it already exports keeps its value unless `override` is on, the way
 * dotenv never overwrites `process.env`. Values expand against everything applied before them.
 */
export const resolveEnv = async (options: ResolveOptions = {}): Promise<Resolution> => {
  const cwd = resolve(options.cwd ?? process.cwd());
  const base = shellBase(options.env ?? launchEnv());
  const config =
    options.config === false ? undefined : (options.config ?? (await configStore.load()));
  const { root, configs: projects } = options.noProject
    ? { root: cwd, configs: [] }
    : await loadProjectConfigs(cwd, base);

  const override =
    options.override ??
    projects.reduce<boolean | undefined>(
      (value, project) => project.override ?? value,
      config?.override,
    ) ??
    false;
  const expand = config?.expand ?? true;

  const working: Record<string, string> = { ...base };
  const lookup = (name: string) => working[name];
  const sources = new Map<string, VarSource[]>();
  const layers: Layer[] = [];

  const apply = (layer: Layer, key: string, value: string, line?: number) => {
    layer.entries.push({ key, value, ...(line !== undefined && { line }) });
    const list = sources.get(key) ?? [];
    list.push({
      layerId: layer.id,
      kind: layer.kind,
      label: layer.label,
      ...(layer.path && { path: layer.path }),
      ...(line !== undefined && { line }),
      value,
    });
    sources.set(key, list);
    if (override || !(key in base)) working[key] = value;
  };

  if (config && Object.keys(config.vars).length) {
    const layer: Layer = {
      id: 'user',
      kind: 'user',
      label: 'your vars',
      path: configStore.path,
      status: 'loaded',
      entries: [],
      errors: [],
    };
    layers.push(layer);
    for (const [key, raw] of Object.entries(config.vars)) {
      apply(layer, key, expandText(raw, lookup, { expand }));
    }
  }

  const rules: DisableRule[] = [
    ...(config?.disabled ?? []).map((pattern) => ({
      pattern,
      dir: cwd,
      by: 'config',
    })),
    ...projects.flatMap((project) =>
      project.disable.map((pattern) => ({
        pattern,
        dir: project.dir,
        by: project.path,
      })),
    ),
  ];
  const listed = [
    ...(config?.files ?? []).map((written) => ({
      written,
      dir: cwd,
      by: 'config',
    })),
    ...projects.flatMap((project) =>
      project.files.map((written) => ({
        written,
        dir: project.dir,
        by: project.path,
      })),
    ),
  ];
  const seen = new Set<string>();
  for (const { written, dir, by } of listed) {
    const path = absolute(dir, written);
    if (seen.has(path)) continue;
    seen.add(path);
    const layer: Layer = {
      id: `file:${path}`,
      kind: 'file',
      label: shortPath(path, cwd),
      path,
      written,
      listedBy: by,
      status: 'loaded',
      entries: [],
      errors: [],
    };
    layers.push(layer);
    const off = disabledBy(path, written, rules);
    if (off) {
      layer.status = 'disabled';
      layer.disabledBy = off;
      continue;
    }
    const read = await readEnvFile(path);
    layer.errors = read.errors;
    if (!read.exists) {
      layer.status = 'missing';
      continue;
    }
    if (read.error) {
      layer.status = 'error';
      layer.error = read.error;
      continue;
    }
    for (const entry of read.entries)
      apply(layer, entry.key, evaluate(entry, lookup, { expand }), entry.line);
  }

  for (const project of projects) {
    const layer: Layer = {
      id: `project:${project.path}`,
      kind: 'project',
      label: `${basename(project.path)} (${project.dir === root ? 'root' : relative(root, project.dir)})`,
      path: project.path,
      status: project.error ? 'error' : 'loaded',
      entries: [],
      errors: [],
      ...(project.error && { error: project.error }),
    };
    layers.push(layer);
    for (const [key, raw] of Object.entries(project.vars)) {
      apply(layer, key, expandText(raw, lookup, { expand }));
    }
  }

  const vars: ResolvedVar[] = [...sources.entries()]
    .map(([key, list]) => {
      const source = list.at(-1) as VarSource;
      const shell = base[key];
      const status: VarStatus =
        shell === undefined
          ? 'new'
          : shell === source.value
            ? 'same'
            : override
              ? 'changed'
              : 'kept';
      return {
        key,
        value: working[key] ?? source.value,
        source,
        shadowed: list.slice(0, -1),
        ...(shell !== undefined && { shell }),
        status,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  const exampleDir = [cwd, root].find((dir) =>
    EXAMPLE_NAMES.some((name) => existsSync(join(dir, name))),
  );
  const exampleName =
    exampleDir && EXAMPLE_NAMES.find((name) => existsSync(join(exampleDir, name)));
  const example = exampleDir && exampleName ? join(exampleDir, exampleName) : undefined;
  const required = new Map<string, string>();
  if (example) {
    const parsed = parseDotenv(
      await Bun.file(example)
        .text()
        .catch(() => ''),
    );
    for (const entry of parsed.entries) required.set(entry.key, shortPath(example, cwd));
  }
  for (const project of projects) {
    for (const key of project.required) required.set(key, shortPath(project.path, cwd));
  }
  const requiredList = [...required.entries()].map(([key, from]) => ({
    key,
    from,
  }));

  return {
    cwd,
    root,
    override,
    base,
    env: working,
    vars,
    layers,
    projects,
    required: requiredList,
    missing: requiredList.filter(({ key }) => working[key] === undefined),
    ...(example && { example }),
  };
};

export const loadedLayers = (resolution: Resolution) =>
  resolution.layers.filter((layer) => layer.status === 'loaded');

export default resolveEnv;
