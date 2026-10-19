import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { PROJECT_CONFIG_NAMES, PROJECT_CONFIG_TEMPLATE } from './config/project';
import {
  configStore,
  type EnviConfig,
  isSecretKey,
  maskValue,
  SET_TARGETS,
  type SetTarget,
  saveConfig,
  saveState,
  stampPath,
  stateStore,
  TAB_IDS,
  toTabId,
  touchStamp,
  withoutVar,
  withVar,
} from './config/settings';
import { removeFromEnvFile, setInEnvFile } from './core/envFile';
import { isOpRef, OP_LABEL } from './core/onePassword';
import { parseAssignment } from './core/parse';
import {
  disableFile,
  enableFile,
  expandHome,
  type Resolution,
  type ResolvedVar,
  resolveEnv,
} from './core/resolve';
import { matchesSearch } from './core/search';
import {
  EXPORT_FORMATS,
  type ExportFormat,
  formatExport,
  formatHookExport,
  hookScript,
  launchEnv,
  SHELLS,
  type Shell,
} from './core/shell';

const HELP = `envi — environment variables: the shell's, the .env files' and your own

usage:
  envi                            open the dashboard
  envi <tab>                      open it on a tab: ${TAB_IDS.join(', ')}
  envi list [search] [--json] [--reveal]
                                  what envi sets here, where each value comes from, and
                                  whether the shell already has it
  envi list --resolve [--only K,K] [search] [--json]
                                  the same, with op:// values read from 1Password and shown
                                  in full — exactly what envi run hands a command
  envi shell [search] [--json] [--reveal]
                                  the current shell's variables; the search matches names
                                  and values (k:word / v:word for one side only)
  envi get <KEY>                  one value as envi resolves it; exits 1 when unset
  envi explain <KEY>              every layer that sets KEY, and which one wins
  envi run [--only K,K] [--] <command...>
                                  run a command with envi's variables (like dotenv-cli);
                                  --only hands it just those on top of the shell's
  envi -- <command...>            the same
  envi use [--only K,K] [--] [command...]
                                  direnv-style: with a command, run it with envi's variables;
                                  alone, print them for this shell — eval "$(envi use)"
  envi export [--shell zsh|bash|sh|fish|dotenv|json]
                                  print envi's variables — eval "$(envi export)"
  envi hook <zsh|bash|fish>       shell code that keeps them applied as you cd:
                                  add  eval "$(envi hook zsh)"  to ~/.zshrc
  envi set KEY=VALUE... [--to .env.user|.env|config|state | --file F | --global | --state]
                                  write variables where the setTarget setting says (.env.user
                                  here unless changed in Settings), or: --to that place,
                                  --file F, --global your vars (config), --state machine vars
  envi unset KEY... [the same flags]
  envi files                      the env files read here, in order, and their state
  envi files add|remove <path>    add a file to (or drop it from) your list
  envi files disable|enable <path>
                                  stop (or start again) reading a file
  envi check                      fail when a required variable is unset (env.config.ts
                                  'required', and the keys of .env.example)
  envi init                       write an env.config.ts template here
  envi config                     where settings are kept

flags: -C <dir> resolve as if run in <dir>.

Layers, a later one winning: your vars (~/.config/envi/config.json) → env files (.env,
.env.user, then env.config.ts 'files') → env.config.ts 'vars', from the git root down to here.
A variable the shell already exports keeps its value unless 'override' is on.

A value written as op://vault/item/field is a 1Password reference: get, run and use <command>
read it with the op CLI; the dashboard, list, export and the hook show it as it is.
`;

const VALUE_FLAGS = new Set([
  '-C',
  '--cwd',
  '--file',
  '-f',
  '--shell',
  '--format',
  '--only',
  '--to',
]);

interface Args {
  positionals: string[];
  flags: Map<string, string | true>;
  /** Everything after `--`, or after `run`. */
  command: string[];
}

export const parseArgs = (argv: string[]): Args => {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let command: string[] = [];
  for (let at = 0; at < argv.length; at++) {
    const arg = argv[at] ?? '';
    if (arg === '--') {
      command = argv.slice(at + 1);
      break;
    }
    //? Everything after `run`'s (or `use`'s) first word belongs to the command, flags included
    if ((positionals[0] === 'run' || positionals[0] === 'use') && !arg.startsWith('-')) {
      command = argv.slice(at);
      break;
    }
    if (arg.startsWith('-') && arg !== '-') {
      const [name = '', inline] = arg.split(/=(.*)/s, 2);
      if (VALUE_FLAGS.has(name)) flags.set(name, inline ?? argv[++at] ?? '');
      else flags.set(name, true);
      continue;
    }
    positionals.push(arg);
  }
  return { positionals, flags, command };
};

const flag = (args: Args, ...names: string[]) => {
  for (const name of names) {
    const value = args.flags.get(name);
    if (typeof value === 'string') return value;
  }
  return undefined;
};

const fail = (message: string) => {
  console.error(message);
  process.exitCode = 1;
};

const STATUS_LABEL: Record<ResolvedVar['status'], string> = {
  new: 'new',
  changed: 'changed',
  same: 'same',
  kept: 'shell',
};

//? An op:// reference is a pointer into 1Password, not the secret — shown as it is
const shown = (key: string, value: string, config: EnviConfig, reveal: boolean) =>
  !reveal && isSecretKey(key, config.maskPatterns) && !isOpRef(value) ? maskValue(value) : value;

/** What a command needs: every `op://` value read from 1Password, asking on this terminal. */
const resolveForCommand = async (cwd: string, config: EnviConfig, secrets: boolean | string[]) => {
  const { vars: stateVars } = await stateStore.load();
  const resolution = await resolveEnv({ cwd, config, stateVars, secrets, interactive: true });
  for (const { key, error } of resolution.secretErrors)
    console.error(`envi: ${key}: ${OP_LABEL}: ${error}`);
  return resolution;
};

/**
 * The environment a command is handed: all of envi's variables, or with `--only` the shell's
 * plus just those. A reference 1Password could not read is left out rather than passed as
 * `op://…`, so the command sees it unset.
 */
const commandEnv = (resolution: Resolution, only?: string[]) => {
  const env = only ? { ...resolution.base } : { ...resolution.env };
  for (const entry of resolution.vars) {
    if (only && !only.includes(entry.key)) continue;
    if (entry.status === 'kept' && !entry.ref) continue;
    if (isOpRef(entry.value)) {
      if (resolution.base[entry.key] === undefined) delete env[entry.key];
      continue;
    }
    env[entry.key] = entry.value;
  }
  return env;
};

const oneLine = (value: string) => value.replace(/\n/g, '\\n');

const where = (source: { label: string; line?: number }) =>
  source.line ? `${source.label}:${source.line}` : source.label;

const printVars = (
  resolution: Resolution,
  config: EnviConfig,
  reveal: boolean,
  query: string,
  only?: string[],
) => {
  const rows = resolution.vars.filter(
    (entry) =>
      (!only || only.includes(entry.key)) &&
      matchesSearch(entry.key, entry.ref ?? entry.value, query),
  );
  if (!rows.length) {
    console.log(
      query
        ? `Nothing envi sets matches "${query}".`
        : 'envi sets nothing here — `envi files` shows what it reads.',
    );
    return;
  }
  const keyWidth = Math.max(3, ...rows.map((row) => row.key.length)) + 2;
  //? A value read from 1Password names its reference as its source — the value column is the value
  const sourceOf = (row: ResolvedVar) =>
    row.ref && row.ref !== row.value ? `${where(row.source)} → ${row.ref}` : where(row.source);
  const sourceWidth = Math.max(6, ...rows.map((row) => sourceOf(row).length)) + 2;
  console.log(`${'KEY'.padEnd(keyWidth)}${'STATUS'.padEnd(9)}${'SOURCE'.padEnd(sourceWidth)}VALUE`);
  for (const row of rows) {
    console.log(
      `${row.key.padEnd(keyWidth)}${STATUS_LABEL[row.status].padEnd(9)}${sourceOf(row).padEnd(sourceWidth)}${oneLine(shown(row.key, row.value, config, reveal))}`,
    );
  }
  for (const { key, error } of resolution.secretErrors)
    if (rows.some((row) => row.key === key)) console.log(`! ${key}: ${OP_LABEL}: ${error}`);
};

const printFiles = (resolution: Resolution) => {
  const files = resolution.layers.filter((layer) => layer.kind === 'file');
  if (!files.length) console.log('No env files are listed — `envi files add .env`.');
  for (const layer of files) {
    const state =
      layer.status === 'loaded'
        ? `${layer.entries.length} vars`
        : layer.status === 'disabled'
          ? `disabled${layer.disabledBy === 'config' ? '' : ` by ${layer.disabledBy}`}`
          : layer.status === 'missing'
            ? 'missing'
            : `error: ${layer.error}`;
    const by = layer.listedBy === 'config' ? '' : `  (from ${layer.listedBy})`;
    console.log(`${layer.status === 'loaded' ? '●' : '○'} ${layer.label.padEnd(28)} ${state}${by}`);
    for (const error of layer.errors) console.log(`    line ${error.line}: ${error.message}`);
  }
  for (const project of resolution.projects) {
    console.log(
      `⚙ ${project.path}${project.error ? `  error: ${project.error}` : `  ${Object.keys(project.vars).length} vars`}`,
    );
  }
};

/** Run a command with `env`, handing it the terminal and passing its exit status on. */
const runCommand = (command: string[], env: Record<string, string>, cwd: string) =>
  new Promise<void>((done) => {
    const [bin = '', ...rest] = command;
    const child = spawn(bin, rest, { env, cwd, stdio: 'inherit' });
    //? The child shares the terminal, so Ctrl+C reaches it directly; envi just waits for it
    const ignore = () => {};
    process.on('SIGINT', ignore);
    child.on('error', (error) => {
      fail(`envi: ${bin}: ${error.message}`);
      done();
    });
    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      process.exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
      done();
    });
  });

type WriteTarget = { kind: 'file'; path: string } | { kind: 'config' } | { kind: 'state' };

/**
 * Where `set`/`unset` write: a flag says so outright (`--file F`, `--global`, `--state`,
 * `--to <target>`), else the `setTarget` setting — `.env.user` here unless changed in Settings.
 */
const writeTarget = (args: Args, cwd: string, config: EnviConfig): WriteTarget | string => {
  const file = flag(args, '--file', '-f');
  if (file) return { kind: 'file', path: resolve(cwd, expandHome(file)) };
  if (args.flags.has('--global')) return { kind: 'config' };
  if (args.flags.has('--state')) return { kind: 'state' };
  const to = flag(args, '--to') ?? config.setTarget;
  if (!SET_TARGETS.includes(to as SetTarget)) return `--to takes ${SET_TARGETS.join(', ')}`;
  if (to === 'config') return { kind: 'config' };
  if (to === 'state') return { kind: 'state' };
  return { kind: 'file', path: join(cwd, to) };
};

const filesCommand = async (args: Args, config: EnviConfig, cwd: string) => {
  const [, action, path] = args.positionals;
  if (!action) {
    printFiles(await resolveEnv({ cwd, config, stateVars: (await stateStore.load()).vars }));
    return;
  }
  if (!path) return fail(`usage: envi files ${action} <path>`);

  if (action === 'add') {
    if (config.files.includes(path)) return console.log(`${path} is already listed`);
    await saveConfig({ ...config, files: [...config.files, path] });
    console.log(`Reading ${path} after ${config.files.at(-1) ?? 'nothing'}`);
    return;
  }
  if (action === 'remove' || action === 'rm') {
    if (!config.files.includes(path))
      return fail(`${path} is not in your list (${config.files.join(', ')})`);
    await saveConfig({
      ...config,
      files: config.files.filter((entry) => entry !== path),
    });
    console.log(`No longer reading ${path}`);
    return;
  }
  if (action === 'disable' || action === 'enable') {
    const resolution = await resolveEnv({ cwd, config, stateVars: (await stateStore.load()).vars });
    const target = resolve(cwd, expandHome(path));
    const layer = resolution.layers.find(
      (candidate) =>
        candidate.kind === 'file' && (candidate.path === target || candidate.written === path),
    );
    if (action === 'disable') {
      const next = layer
        ? disableFile(config, layer)
        : { ...config, disabled: [...new Set([...config.disabled, path])] };
      await saveConfig(next);
      console.log(`Not reading ${path}`);
      return;
    }
    if (layer?.disabledBy && layer.disabledBy !== 'config') {
      return fail(`${path} is disabled by ${layer.disabledBy} — edit it there`);
    }
    const next = layer
      ? enableFile(config, layer, cwd)
      : {
          ...config,
          disabled: config.disabled.filter((entry) => entry !== path),
        };
    await saveConfig(next);
    console.log(`Reading ${path} again`);
    return;
  }
  fail(`Unknown "files ${action}" — add, remove, enable or disable`);
};

/**
 * `envi [tab | list | shell | get | explain | run | export | hook | set | unset | files | check |
 * init | config] [flags]`.
 *
 * The dashboard is imported lazily, so every scripted command — the shell hook above all, which
 * runs on every `cd` — never loads React or Ink.
 */
export const run = async (...argv: string[]) => {
  const args = parseArgs(argv);
  const [first, ...rest] = args.positionals;
  const cwd = resolve(flag(args, '-C', '--cwd') ?? process.cwd());
  const reveal = args.flags.has('--reveal');
  const json = args.flags.has('--json');
  const only = flag(args, '--only')
    ?.split(',')
    .map((key) => key.trim())
    .filter(Boolean);

  if (first === 'help' || args.flags.has('--help') || args.flags.has('-h')) {
    process.stdout.write(HELP);
    return;
  }

  if (first === 'hook') {
    const shell = (rest[0] ?? 'zsh') as Shell;
    if (!SHELLS.includes(shell)) return fail(`usage: envi hook <${SHELLS.join('|')}>`);
    process.stdout.write(hookScript(shell));
    return;
  }

  const config = await configStore.load();
  const state = await stateStore.load();

  if (first === 'run' || (!first && args.command.length)) {
    if (!args.command.length) return fail('usage: envi run [--] <command...>');
    const resolution = await resolveForCommand(cwd, config, only ?? true);
    for (const { key, from } of resolution.missing)
      console.error(`envi: ${key} is unset (required by ${from})`);
    await runCommand(args.command, commandEnv(resolution, only), cwd);
    return;
  }

  //? direnv's two halves under one word: a command gets the variables in its environment, and
  //? with none they are printed as code for the caller's shell (--shell, else $SHELL) to eval
  if (first === 'use') {
    //? Printed for eval, references stay as they are — reading them is for a command that runs
    const resolution = args.command.length
      ? await resolveForCommand(cwd, config, only ?? true)
      : await resolveEnv({ cwd, config, stateVars: state.vars });
    for (const { key, from } of resolution.missing)
      console.error(`envi: ${key} is unset (required by ${from})`);
    if (args.command.length) {
      await runCommand(args.command, commandEnv(resolution, only), cwd);
      return;
    }
    const login = basename(process.env.SHELL ?? '') as ExportFormat;
    const format = (flag(args, '--shell', '--format') ??
      (EXPORT_FORMATS.includes(login) ? login : 'sh')) as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) return fail(`--shell takes ${EXPORT_FORMATS.join(', ')}`);
    process.stdout.write(formatExport(resolution, format));
    return;
  }

  if (first === 'export') {
    const format = (flag(args, '--shell', '--format') ?? 'zsh') as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) return fail(`--shell takes ${EXPORT_FORMATS.join(', ')}`);
    const resolution = await resolveEnv({ cwd, config, stateVars: state.vars });
    if (args.flags.has('--hook')) {
      if (format === 'dotenv' || format === 'json') return fail('--hook needs a shell');
      const stamp = (
        await Bun.file(stampPath())
          .text()
          .catch(() => '')
      ).trim();
      process.stdout.write(formatHookExport(resolution, format, launchEnv(), stamp));
    } else process.stdout.write(formatExport(resolution, format));
    return;
  }

  if (first === 'list' || first === 'ls') {
    //? --resolve: what `envi run` would hand a command — references read from 1Password, all
    //? of them or just --only's; without it nothing is read and references show as they are
    const resolving = args.flags.has('--resolve');
    //? Asking to resolve is asking to see the values — exactly what `run` would hand over
    const showAll = reveal || resolving;
    const resolution = resolving
      ? await resolveForCommand(cwd, config, only ?? true)
      : await resolveEnv({ cwd, config, stateVars: state.vars });
    const listed = only ?? undefined;
    if (json) {
      console.log(
        JSON.stringify(
          resolution.vars
            .filter((entry) => !listed || listed.includes(entry.key))
            .map((entry) => ({
              ...entry,
              value: shown(entry.key, entry.value, config, showAll),
            })),
          null,
          2,
        ),
      );
    } else printVars(resolution, config, showAll, rest.join(' '), listed);
    return;
  }

  if (first === 'shell' || first === 'env') {
    const query = rest.join(' ');
    const env = Object.entries(launchEnv())
      .filter(([key, value]) => matchesSearch(key, value, query))
      .sort(([a], [b]) => a.localeCompare(b));
    if (json) {
      console.log(
        JSON.stringify(
          Object.fromEntries(env.map(([key, value]) => [key, shown(key, value, config, reveal)])),
          null,
          2,
        ),
      );
      return;
    }
    for (const [key, value] of env)
      console.log(`${key}=${oneLine(shown(key, value, config, reveal))}`);
    if (!env.length && query) fail(`No variable matches "${query}"`);
    return;
  }

  if (first === 'get') {
    const key = rest[0];
    if (!key) return fail('usage: envi get <KEY>');
    const resolution = await resolveForCommand(cwd, config, [key]);
    const value = resolution.env[key];
    if (value === undefined) return fail(`${key} is not set`);
    if (resolution.secretErrors.length) return fail(`${key} is an unread ${OP_LABEL} reference`);
    console.log(value);
    return;
  }

  if (first === 'explain' || first === 'why') {
    const key = rest[0];
    if (!key) return fail('usage: envi explain <KEY>');
    const resolution = await resolveEnv({ cwd, config, stateVars: state.vars });
    const entry = resolution.vars.find((candidate) => candidate.key === key);
    const shell = resolution.base[key];
    if (!entry) {
      if (shell === undefined) return fail(`${key} is not set — not by the shell, not by envi`);
      console.log(`${key} comes from the shell; no envi layer sets it`);
      console.log(`  = ${oneLine(shown(key, shell, config, reveal))}`);
      return;
    }
    for (const source of entry.shadowed) {
      console.log(
        `  ${where(source).padEnd(32)} ${oneLine(shown(key, source.value, config, reveal))}  (overridden)`,
      );
    }
    console.log(
      `→ ${where(entry.source).padEnd(32)} ${oneLine(shown(key, entry.source.value, config, reveal))}`,
    );
    if (shell !== undefined) {
      console.log(
        entry.status === 'kept'
          ? `  the shell's own value wins (override is off): ${oneLine(shown(key, shell, config, reveal))}`
          : entry.status === 'changed'
            ? `  replaces the shell's ${oneLine(shown(key, shell, config, reveal))} (override is on)`
            : '  the shell already has this value',
      );
    }
    return;
  }

  if (first === 'set') {
    const assignments = rest.map((text) => ({
      text,
      parsed: parseAssignment(text),
    }));
    const bad = assignments.find((entry) => !entry.parsed);
    if (!assignments.length || bad)
      return fail(bad ? `"${bad.text}" is not KEY=VALUE` : 'usage: envi set KEY=VALUE...');
    const target = writeTarget(args, cwd, config);
    if (typeof target === 'string') return fail(target);
    const keys = assignments.map((entry) => entry.parsed?.key).join(', ');
    if (target.kind === 'config') {
      let vars = config.vars;
      for (const { parsed } of assignments)
        if (parsed) vars = withVar(vars, parsed.key, parsed.value);
      await saveConfig({ ...config, vars });
      console.log(`Set ${keys} in your vars — ${configStore.path}`);
      return;
    }
    if (target.kind === 'state') {
      let vars = state.vars;
      for (const { parsed } of assignments)
        if (parsed) vars = withVar(vars, parsed.key, parsed.value);
      await saveState({ ...state, vars });
      console.log(`Set ${keys} in machine vars — ${stateStore.path}`);
      return;
    }
    for (const { parsed } of assignments)
      if (parsed) await setInEnvFile(target.path, parsed.key, parsed.value);
    await touchStamp();
    console.log(`Set ${keys} in ${target.path}`);
    return;
  }

  if (first === 'unset') {
    if (!rest.length) return fail('usage: envi unset KEY...');
    const target = writeTarget(args, cwd, config);
    if (typeof target === 'string') return fail(target);
    if (target.kind === 'config' || target.kind === 'state') {
      const vars = target.kind === 'config' ? config.vars : state.vars;
      const missing = rest.filter((key) => !(key in vars));
      const next = rest.reduce(withoutVar, vars);
      if (target.kind === 'config') await saveConfig({ ...config, vars: next });
      else await saveState({ ...state, vars: next });
      const where = target.kind === 'config' ? 'your vars' : 'machine vars';
      if (missing.length) console.log(`Not in ${where}: ${missing.join(', ')}`);
      return;
    }
    let removed = 0;
    for (const key of rest) removed += await removeFromEnvFile(target.path, key);
    await touchStamp();
    console.log(`Removed ${removed} line(s) from ${target.path}`);
    return;
  }

  if (first === 'files') return filesCommand(args, config, cwd);

  if (first === 'check') {
    const resolution = await resolveEnv({ cwd, config, stateVars: state.vars });
    if (!resolution.required.length) {
      console.log('Nothing is required here — no env.config.ts `required`, no .env.example.');
      return;
    }
    for (const { key, from } of resolution.missing)
      console.log(`✗ ${key.padEnd(28)} required by ${from}`);
    const ok = resolution.required.length - resolution.missing.length;
    console.log(`${ok}/${resolution.required.length} required variables set`);
    if (resolution.missing.length) process.exitCode = 1;
    return;
  }

  if (first === 'init') {
    const existing = PROJECT_CONFIG_NAMES.map((name) => join(cwd, name)).find(existsSync);
    if (existing) return fail(`${existing} already exists`);
    const path = join(cwd, 'env.config.ts');
    await Bun.write(path, PROJECT_CONFIG_TEMPLATE);
    await touchStamp();
    console.log(`Wrote ${path}`);
    return;
  }

  if (first === 'config') {
    const resolution = await resolveEnv({ cwd, config, stateVars: state.vars });
    console.log(`${configStore.path} (your files, vars and settings)`);
    for (const project of resolution.projects) console.log(`${project.path} (workspace)`);
    return;
  }

  const tab = first === undefined ? undefined : toTabId(first);
  if (first !== undefined && !tab) {
    fail(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(tab, cwd);
};

export default run;
