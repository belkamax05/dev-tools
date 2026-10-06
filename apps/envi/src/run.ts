import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { join, resolve } from 'node:path';

import { PROJECT_CONFIG_NAMES, PROJECT_CONFIG_TEMPLATE } from './config/project';
import {
  configStore,
  type EnviConfig,
  isSecretKey,
  maskValue,
  saveConfig,
  stampPath,
  TAB_IDS,
  type TabId,
  touchStamp,
  withoutVar,
  withVar,
} from './config/settings';
import { removeFromEnvFile, setInEnvFile } from './core/envFile';
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
  envi shell [search] [--json] [--reveal]
                                  the current shell's variables; the search matches names
                                  and values (k:word / v:word for one side only)
  envi get <KEY>                  one value as envi resolves it; exits 1 when unset
  envi explain <KEY>              every layer that sets KEY, and which one wins
  envi run [--] <command...>      run a command with envi's variables (like dotenv-cli)
  envi -- <command...>            the same
  envi export [--shell zsh|bash|sh|fish|dotenv|json]
                                  print envi's variables — eval "$(envi export)"
  envi hook <zsh|bash|fish>       shell code that keeps them applied as you cd:
                                  add  eval "$(envi hook zsh)"  to ~/.zshrc
  envi set KEY=VALUE... [--file F | --global]
                                  write variables: to .env.user here (default), to file F,
                                  or to your own vars (every folder)
  envi unset KEY... [--file F | --global]
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
`;

const VALUE_FLAGS = new Set(['-C', '--cwd', '--file', '-f', '--shell', '--format']);

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
    //? Everything after `run`'s first word belongs to the command, flags included
    if (positionals[0] === 'run' && !arg.startsWith('-')) {
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

const shown = (key: string, value: string, config: EnviConfig, reveal: boolean) =>
  !reveal && isSecretKey(key, config.maskPatterns) ? maskValue(value) : value;

const oneLine = (value: string) => value.replace(/\n/g, '\\n');

const where = (source: { label: string; line?: number }) =>
  source.line ? `${source.label}:${source.line}` : source.label;

const printVars = (resolution: Resolution, config: EnviConfig, reveal: boolean, query: string) => {
  const rows = resolution.vars.filter((entry) => matchesSearch(entry.key, entry.value, query));
  if (!rows.length) {
    console.log(
      query
        ? `Nothing envi sets matches "${query}".`
        : 'envi sets nothing here — `envi files` shows what it reads.',
    );
    return;
  }
  const keyWidth = Math.max(3, ...rows.map((row) => row.key.length)) + 2;
  const sourceWidth = Math.max(6, ...rows.map((row) => where(row.source).length)) + 2;
  console.log(`${'KEY'.padEnd(keyWidth)}${'STATUS'.padEnd(9)}${'SOURCE'.padEnd(sourceWidth)}VALUE`);
  for (const row of rows) {
    console.log(
      `${row.key.padEnd(keyWidth)}${STATUS_LABEL[row.status].padEnd(9)}${where(row.source).padEnd(sourceWidth)}${oneLine(shown(row.key, row.value, config, reveal))}`,
    );
  }
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

const fileTarget = (args: Args, cwd: string) => {
  const file = flag(args, '--file', '-f');
  return file ? resolve(cwd, expandHome(file)) : join(cwd, '.env.user');
};

const filesCommand = async (args: Args, config: EnviConfig, cwd: string) => {
  const [, action, path] = args.positionals;
  if (!action) {
    printFiles(await resolveEnv({ cwd, config }));
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
    const resolution = await resolveEnv({ cwd, config });
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

  if (first === 'run' || (!first && args.command.length)) {
    if (!args.command.length) return fail('usage: envi run [--] <command...>');
    const resolution = await resolveEnv({ cwd, config });
    for (const { key, from } of resolution.missing)
      console.error(`envi: ${key} is unset (required by ${from})`);
    await runCommand(args.command, resolution.env, cwd);
    return;
  }

  if (first === 'export') {
    const format = (flag(args, '--shell', '--format') ?? 'zsh') as ExportFormat;
    if (!EXPORT_FORMATS.includes(format)) return fail(`--shell takes ${EXPORT_FORMATS.join(', ')}`);
    const resolution = await resolveEnv({ cwd, config });
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
    const resolution = await resolveEnv({ cwd, config });
    if (json) {
      console.log(
        JSON.stringify(
          resolution.vars.map((entry) => ({
            ...entry,
            value: shown(entry.key, entry.value, config, reveal),
          })),
          null,
          2,
        ),
      );
    } else printVars(resolution, config, reveal, rest.join(' '));
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
    const value = (await resolveEnv({ cwd, config })).env[key];
    if (value === undefined) return fail(`${key} is not set`);
    console.log(value);
    return;
  }

  if (first === 'explain' || first === 'why') {
    const key = rest[0];
    if (!key) return fail('usage: envi explain <KEY>');
    const resolution = await resolveEnv({ cwd, config });
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
    if (args.flags.has('--global')) {
      let vars = config.vars;
      for (const { parsed } of assignments)
        if (parsed) vars = withVar(vars, parsed.key, parsed.value);
      await saveConfig({ ...config, vars });
      console.log(`Set ${assignments.length} in your vars — ${configStore.path}`);
      return;
    }
    const path = fileTarget(args, cwd);
    for (const { parsed } of assignments)
      if (parsed) await setInEnvFile(path, parsed.key, parsed.value);
    await touchStamp();
    console.log(`Set ${assignments.map((entry) => entry.parsed?.key).join(', ')} in ${path}`);
    return;
  }

  if (first === 'unset') {
    if (!rest.length) return fail('usage: envi unset KEY...');
    if (args.flags.has('--global')) {
      const missing = rest.filter((key) => !(key in config.vars));
      await saveConfig({
        ...config,
        vars: rest.reduce(withoutVar, config.vars),
      });
      if (missing.length) console.log(`Not in your vars: ${missing.join(', ')}`);
      return;
    }
    const path = fileTarget(args, cwd);
    let removed = 0;
    for (const key of rest) removed += await removeFromEnvFile(path, key);
    await touchStamp();
    console.log(`Removed ${removed} line(s) from ${path}`);
    return;
  }

  if (first === 'files') return filesCommand(args, config, cwd);

  if (first === 'check') {
    const resolution = await resolveEnv({ cwd, config });
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
    const resolution = await resolveEnv({ cwd, config });
    console.log(`${configStore.path} (your files, vars and settings)`);
    for (const project of resolution.projects) console.log(`${project.path} (workspace)`);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    fail(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(first as TabId | undefined, cwd);
};

export default run;
