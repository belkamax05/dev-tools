import { detectPackageManager, runScriptCommand } from '../../../../pkgi/src/core/manifest';
import type { AliasSpec } from '../config';
import { readScripts } from '../scripts';

/**
 * A command the caller brings itself — dfs passes its `fe/*` command files this way. It wins over
 * an alias or a package.json script of the same name.
 */
export interface Override {
  name: string;
  description?: string;
  args?: string;
  hidden?: boolean;
  /**
   * The program that runs it, as argv — the caller's arguments are appended. This is what the
   * dashboard hands the terminal to, so give it whenever the command can run as a process.
   */
  command?: string[];
  /**
   * Runs it in-process, for the command line (`dfs fe start`) — preferred over `command` there,
   * as it skips a process. Resolves with an exit code (nothing = 0).
   */
  run?: (args: string[]) => Promise<number | undefined | void>;
  /** Subcommands, which makes it a group. */
  children?: Override[];
}

export type CommandSource = 'override' | 'alias' | 'script';

export interface ProjiCommand {
  name: string;
  source: CommandSource;
  description?: string;
  args?: string;
  hidden?: boolean;
  children?: ProjiCommand[];
  /** The full command line for these arguments, when it can run as its own process. */
  argv?: (args: string[]) => string[];
  /** Run it here, with the terminal as it is; resolves with the exit code. */
  run?: (args: string[]) => Promise<number>;
}

export interface ProjectOptions {
  /** The project's folder: aliases and scripts run here, its package.json is read from here. */
  root: string;
  /** Dashboard header, e.g. `dfs fe`. */
  title: string;
  /** Leads the command lines the dashboard shows; defaults to `title`. */
  commandPrefix?: string;
  overrides?: Override[];
  /** From a `proji.config.ts` — see `AliasSpec`. */
  aliases?: Record<string, AliasSpec>;
}

/** Run `argv` in `cwd` with the terminal handed over; resolves with its exit code. */
export const spawnInherit = async (argv: string[], cwd: string): Promise<number> => {
  const proc = Bun.spawn(argv, { cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
};

const fromOverride = (override: Override, root: string): ProjiCommand => {
  const { command } = override;
  const argv = command && ((args: string[]) => [...command, ...args]);
  return {
    name: override.name,
    source: 'override',
    description: override.description,
    args: override.args,
    hidden: override.hidden,
    children: override.children?.map((child) => fromOverride(child, root)),
    argv,
    run: override.run
      ? async (args) => (await override.run?.(args)) ?? 0
      : argv && ((args) => spawnInherit(argv(args), root)),
  };
};

/** A command whose whole definition is its command line, run in `root`. */
const fromArgv = (
  base: Omit<ProjiCommand, 'argv' | 'run'>,
  argv: (args: string[]) => string[],
  root: string,
): ProjiCommand => ({ ...base, argv, run: (args) => spawnInherit(argv(args), root) });

const fromAlias = (root: string, manager: string, name: string, spec: AliasSpec): ProjiCommand => {
  if (typeof spec !== 'string' && 'script' in spec) {
    return fromArgv(
      { name, source: 'alias', description: spec.description ?? `→ script ${spec.script}` },
      (args) => runScriptCommand(manager as never, spec.script, args),
      root,
    );
  }
  const line = typeof spec === 'string' ? spec : spec.run;
  const description = typeof spec === 'string' ? undefined : spec.description;
  return fromArgv(
    { name, source: 'alias', description: description ?? `→ ${line}` },
    //? The caller's arguments are appended as separate words, quoting intact: `sh -c '<line> "$@"'`
    (args) => ['sh', '-c', `${line} "$@"`, name, ...args],
    root,
  );
};

/**
 * Everything the project offers, one entry per name: the caller's overrides, then the aliases,
 * then the package.json scripts. A name taken by an earlier kind hides the later one, so an
 * override called `lint` is what `lint` means, and the `lint` script no longer shows. Scripts run
 * through the project's own package manager (pkgi's detection).
 */
export const collectCommands = async ({
  root,
  overrides = [],
  aliases = {},
}: ProjectOptions): Promise<ProjiCommand[]> => {
  const [{ name: manager }, scripts] = await Promise.all([
    detectPackageManager(root),
    readScripts(root),
  ]);
  const commands = overrides.map((override) => fromOverride(override, root));
  const taken = new Set(commands.map((command) => command.name));
  for (const [name, spec] of Object.entries(aliases)) {
    if (taken.has(name)) continue;
    commands.push(fromAlias(root, manager, name, spec));
    taken.add(name);
  }
  for (const script of scripts) {
    if (taken.has(script.name)) continue;
    commands.push(
      fromArgv(
        { name: script.name, source: 'script', description: script.command },
        (args) => runScriptCommand(manager, script.name, args),
        root,
      ),
    );
    taken.add(script.name);
  }
  return commands;
};

export interface Resolution {
  command?: ProjiCommand;
  /** The names matched on the way down, outermost first. */
  path: string[];
  /** What is left for the command itself. */
  args: string[];
}

/** Match `argv` against the commands, descending into groups while the next word names a child. */
export const resolveCommand = (commands: ProjiCommand[], argv: string[]): Resolution => {
  let level = commands;
  let command: ProjiCommand | undefined;
  let depth = 0;
  while (depth < argv.length) {
    const next = level.find((candidate) => candidate.name === argv[depth]);
    if (!next) break;
    command = next;
    depth += 1;
    level = next.children ?? [];
  }
  return { command, path: argv.slice(0, depth), args: argv.slice(depth) };
};

/** One line per command, for `list`, for "not found" errors, and when there is no terminal. */
export const formatList = (commands: ProjiCommand[]) => {
  const visible = commands.filter((command) => !command.hidden);
  const width = Math.max(0, ...visible.map((command) => command.name.length));
  return visible
    .map((command) =>
      `  ${command.name.padEnd(width)}  ${(command.children ? 'group' : command.source).padEnd(8)} ${command.description ?? ''}`.trimEnd(),
    )
    .join('\n');
};

/**
 * The whole of `dfs fe`, `dfs self` and standalone `proji`: with no arguments the dashboard over
 * the project's commands, otherwise run the one named. Resolves with the exit code to use.
 */
export const runProject = async (options: ProjectOptions, argv: string[]): Promise<number> => {
  const commands = await collectCommands(options);
  const { command, path, args } = resolveCommand(commands, argv);

  if (argv.length > 0 && !command) {
    console.error(`No command or script "${argv[0]}" in ${options.root}.\n`);
    console.error(formatList(commands));
    return 1;
  }

  //? A runnable command takes the rest of the words as its arguments
  if (command?.run) return command.run(args);

  //? A group with no action of its own: a word that is not one of its children is a mistake,
  //? nothing more opens the dashboard inside it
  if (command && args.length > 0) {
    console.error(`No "${args[0]}" in ${path.join(' ')}.\n`);
    console.error(formatList(command.children ?? []));
    return 1;
  }

  //? No terminal to draw on (piped, CI): the list is the useful answer
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.log(formatList(command?.children ?? commands));
    return 0;
  }

  //? Loaded only when shown: Ink brings top-level await (yoga-layout), which would make every
  //? importer of this module async and unloadable through require() - dfs loads commands that way
  const { default: renderDashboard } = await import('../../ui/renderDashboard');
  return renderDashboard({ ...options, initialPath: path });
};

export default runProject;
