import { basename } from 'node:path';

import { loadConfig, resolveNamedProject } from './core/config';
import { collectCommands, formatList, type ProjectOptions, runProject } from './core/project';
import { findProjectRoot } from './core/scripts';

const help = () => `proji — a project's commands in one picker

usage:
  proji                          pick from this project's aliases and package.json scripts
  proji <command> [args...]      run one (an alias wins over a script of the same name)
  proji run <command> [args...]  the same, for a command called "list" or "help"
  proji -p <name> [command ...]  a project named in proji.config.ts, e.g. proji -p fe dev
  proji list [--json]            everything proji offers here

The project is the nearest folder with a package.json. Aliases come from the nearest
proji.config.ts (or $PROJI_PROJECT_DIR's) - see the README. Scripts run through the project's
own package manager (packageManager field, else lockfile).
`;

/** Where `argv` points: a named project of the config, or the one around the current folder. */
const projectFor = async (argv: string[]) => {
  const loaded = await loadConfig();
  if (loaded.error) console.error(`proji: ignoring ${loaded.path}: ${loaded.error}`);

  if (argv[0] === '-p' || argv[0] === '--project') {
    const name = argv[1];
    const named = name ? resolveNamedProject(loaded, name) : undefined;
    if (!named) {
      const known = Object.keys(loaded.config.projects ?? {});
      throw new Error(
        `No project "${name ?? ''}" in ${loaded.path ?? 'any proji.config.ts'}${known.length ? ` (known: ${known.join(', ')})` : ''}`,
      );
    }
    const options: ProjectOptions = {
      root: named.root,
      title: named.title ?? `proji -p ${name}`,
      aliases: named.commands,
    };
    return { options, rest: argv.slice(2) };
  }

  const root = findProjectRoot(process.cwd());
  if (!root) throw new Error('No package.json here or above — proji needs a project to work on.');
  //? The config's own `commands` belong to the folder the config sits in, not to any project below
  const ownsConfig = loaded.path !== undefined && findProjectRoot(loaded.path) === root;
  const options: ProjectOptions = {
    root,
    title: `proji · ${basename(root)}`,
    commandPrefix: 'proji',
    aliases: ownsConfig ? loaded.config.commands : undefined,
  };
  return { options, rest: argv };
};

/** `proji [-p name] [command] [args...]` — see `help`. */
export const run = async (...argv: string[]) => {
  if (argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(help());
    return;
  }

  try {
    const { options, rest } = await projectFor(argv);

    if (rest[0] === 'list' || rest[0] === 'ls') {
      const commands = await collectCommands(options);
      if (rest.includes('--json')) {
        console.log(
          JSON.stringify(
            commands.map(({ name, source, description }) => ({ name, source, description })),
            null,
            2,
          ),
        );
      } else {
        console.log(formatList(commands));
      }
      return;
    }

    const words = rest[0] === 'run' ? rest.slice(1) : rest;
    process.exitCode = await runProject(options, words);
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
  }
};

export default run;
