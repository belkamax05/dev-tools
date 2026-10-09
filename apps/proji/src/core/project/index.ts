import type PickerItem from '@/dev-tools/types/PickerItem';

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
  /** Runs it with the arguments after its name; resolves with an exit code (nothing = 0). */
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
  run?: (args: string[]) => Promise<number>;
}

export interface ProjectOptions {
  /** The project's folder: aliases and scripts run here, its package.json is read from here. */
  root: string;
  /** Picker header, e.g. `dfs fe`. */
  title: string;
  /** Leads the command line the picker previews; defaults to `title`. */
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

/** `root`'s package.json script `name`, through the package manager the project uses. */
export const runScript = async (root: string, name: string, args: string[] = []) => {
  const { name: manager } = await detectPackageManager(root);
  return spawnInherit(runScriptCommand(manager, name, args), root);
};

const fromOverride = (override: Override): ProjiCommand => ({
  name: override.name,
  source: 'override',
  description: override.description,
  args: override.args,
  hidden: override.hidden,
  children: override.children?.map(fromOverride),
  run: override.run && (async (args) => (await override.run?.(args)) ?? 0),
});

const fromAlias = (root: string, name: string, spec: AliasSpec): ProjiCommand => {
  if (typeof spec !== 'string' && 'script' in spec) {
    return {
      name,
      source: 'alias',
      description: spec.description ?? `→ script ${spec.script}`,
      run: (args) => runScript(root, spec.script, args),
    };
  }
  const line = typeof spec === 'string' ? spec : spec.run;
  const description = typeof spec === 'string' ? undefined : spec.description;
  return {
    name,
    source: 'alias',
    description: description ?? `→ ${line}`,
    //? The caller's arguments are appended as separate words, quoting intact: `sh -c '<line> "$@"'`
    run: (args) => spawnInherit(['sh', '-c', `${line} "$@"`, name, ...args], root),
  };
};

/**
 * Everything the project offers, one entry per name: the caller's overrides, then the aliases,
 * then the package.json scripts. A name taken by an earlier kind hides the later one, so an
 * override called `lint` is what `lint` means, and the `lint` script no longer shows.
 */
export const collectCommands = async ({
  root,
  overrides = [],
  aliases = {},
}: ProjectOptions): Promise<ProjiCommand[]> => {
  const commands = overrides.map(fromOverride);
  const taken = new Set(commands.map((command) => command.name));
  for (const [name, spec] of Object.entries(aliases)) {
    if (taken.has(name)) continue;
    commands.push(fromAlias(root, name, spec));
    taken.add(name);
  }
  for (const script of await readScripts(root)) {
    if (taken.has(script.name)) continue;
    commands.push({
      name: script.name,
      source: 'script',
      description: script.command,
      run: (args) => runScript(root, script.name, args),
    });
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

const sourceNote: Record<CommandSource, string> = {
  override: '',
  alias: 'alias',
  script: 'script',
};

const toPickerItems = (commands: ProjiCommand[], parent: string[] = []): PickerItem[] =>
  commands.map((command) => {
    const path = [...parent, command.name];
    const note = sourceNote[command.source];
    return {
      value: path.join(' '),
      label: command.name,
      description: [note, command.description].filter(Boolean).join(' · ') || undefined,
      args: command.args,
      hidden: command.hidden,
      children: command.children && (() => toPickerItems(command.children ?? [], path)),
      runnable: Boolean(command.children && command.run),
    };
  });

/** One line per command, for `list` and for "not found" errors. */
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
 * The whole of `dfs fe`, `dfs self` and standalone `proji`: with no arguments a picker over the
 * project's commands, otherwise run the one named. Resolves with the exit code to use.
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
  //? nothing more opens the picker inside it
  if (command && args.length > 0) {
    console.error(`No "${args[0]}" in ${path.join(' ')}.\n`);
    console.error(formatList(command.children ?? []));
    return 1;
  }

  //? Loaded only when shown: Ink brings top-level await (yoga-layout), which would make every
  //? importer of this module async and unloadable through require() - dfs loads commands that way
  const { default: pickCommand } = await import('@/dev-tools/ui/dialogs/pickCommand');
  const selection = await pickCommand({
    items: toPickerItems(commands),
    title: options.title,
    commandPrefix: options.commandPrefix,
    initialPath: path,
  });
  if (!selection) return 0;
  const picked = resolveCommand(commands, selection.item.value.split(' '));
  return picked.command?.run ? picked.command.run([]) : 0;
};

export default runProject;
