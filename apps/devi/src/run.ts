import * as p from '@clack/prompts';

import { configStore, RESERVED } from './config/settings';
import { type AppEntry, describeAlias, discoverApps, runApp } from './core/apps';
import { listAliases, resolveCommand, splitWords } from './core/resolve';

const help = (apps: AppEntry[]) => `dev-tools (devi) — one entry point for every dev-tools app

usage:
  dev-tools                        pick an app (or one of your aliases) from a list
  dev-tools <app|alias> [args...]  run it, as if its own command had been typed
  dev-tools list [--json]          the apps and their aliases
  dev-tools alias                  every alias and what it runs
  dev-tools alias <name> <command...>
                                   add or change one of yours: \`dev-tools alias kp porti kill\`
                                   makes \`dev-tools kp 3000\` run \`porti kill 3000\`
  dev-tools alias --remove <name>  delete one of yours

apps:
${apps.map((app) => `  ${app.name.padEnd(10)} ${app.description}${app.aliases.length ? `  (${app.aliases.map((alias) => describeAlias(app, alias)).join(', ')})` : ''}`).join('\n')}

Your aliases live in ${configStore.path}. An app's own name always wins over an alias.
`;

/** `dev-tools` alone: a list of the apps and your aliases, and run what is picked. */
const pick = async (apps: AppEntry[], aliases: Record<string, string>) => {
  p.intro('dev-tools');
  const choice = await p.select<string[]>({
    message: 'Open which app?',
    options: [
      ...apps.map((app) => ({
        value: [app.name],
        label: app.name,
        hint: [
          app.description,
          app.aliases.length
            ? `aka ${app.aliases.map((alias) => describeAlias(app, alias)).join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
      ...Object.entries(aliases).map(([alias, target]) => ({
        value: [alias],
        label: alias,
        hint: `your alias → ${target}`,
      })),
    ],
  });
  if (p.isCancel(choice)) {
    p.cancel('Nothing opened');
    return undefined;
  }
  p.outro(`${choice.join(' ')}`);
  return choice;
};

const aliasCommand = async (apps: AppEntry[], args: string[], flags: Set<string>) => {
  const config = await configStore.load();

  if (flags.has('--remove')) {
    const [name] = args;
    if (!name || !(name in config.aliases)) {
      console.error(
        name ? `No alias of yours called "${name}"` : 'usage: dev-tools alias --remove <name>',
      );
      process.exitCode = 1;
      return;
    }
    delete config.aliases[name];
    await configStore.save(config);
    console.log(`Removed ${name}`);
    return;
  }

  const [name, ...target] = args;
  if (!name) {
    const rows = listAliases(apps, config.aliases);
    if (!rows.length) console.log('No aliases.');
    for (const row of rows) {
      const note = row.shadowed ? '  (hidden — an app or your alias of that name wins)' : '';
      console.log(
        `${row.alias.padEnd(12)} → ${row.target.padEnd(24)} ${row.source === 'user' ? 'yours' : `from ${row.source}`}${note}`,
      );
    }
    return;
  }

  if (!/^[\w.:-]+$/.test(name)) {
    console.error(`"${name}" cannot be an alias — letters, digits, and . _ : - only`);
    process.exitCode = 1;
    return;
  }
  if ((RESERVED as readonly string[]).includes(name) || apps.some((app) => app.name === name)) {
    console.error(
      `"${name}" is taken by ${apps.some((app) => app.name === name) ? 'an app' : 'dev-tools itself'}`,
    );
    process.exitCode = 1;
    return;
  }
  if (!target.length) {
    console.log(config.aliases[name] ?? `No alias of yours called "${name}"`);
    return;
  }

  //? One argument with spaces in it (`dev-tools alias kp "porti kill"`) and several words mean
  //? the same thing; the target is stored as the command line it will be split back into
  const line =
    target.length === 1
      ? (target[0] ?? '')
      : target.map((word) => (/\s/.test(word) ? `"${word}"` : word)).join(' ');
  const trial = resolveCommand([name], apps, { ...config.aliases, [name]: line });
  if (trial.kind !== 'app') {
    console.error(
      trial.kind === 'loop'
        ? `That would loop: ${trial.chain.join(' → ')}`
        : `"${splitWords(line)[0]}" is neither an app nor an alias`,
    );
    process.exitCode = 1;
    return;
  }
  config.aliases[name] = line;
  await configStore.save(config);
  console.log(`dev-tools ${name} → ${trial.app.name} ${trial.args.join(' ')}`.trimEnd());
};

/**
 * `dev-tools [app | alias | list | alias ...] [args...]` — devi, the launcher.
 *
 * Everything after the app's name is handed to it untouched, flags included, so `dev-tools porti
 * kill 3000 --force` is exactly `porti kill 3000 --force`. The launcher's own words (`list`,
 * `alias`, `help`) are only read in first position.
 */
export const run = async (...argv: string[]) => {
  const apps = await discoverApps();
  const [first, ...rest] = argv;

  if (first === 'help' || first === '--help' || first === '-h') {
    process.stdout.write(help(apps));
    return;
  }

  if (first === 'list' || first === 'ls') {
    if (rest.includes('--json')) {
      console.log(
        JSON.stringify(
          apps.map(({ runPath: _runPath, ...app }) => app),
          null,
          2,
        ),
      );
      return;
    }
    for (const app of apps) {
      console.log(
        `${app.name.padEnd(10)} ${app.description}${app.aliases.length ? `  (${app.aliases.map((alias) => describeAlias(app, alias)).join(', ')})` : ''}`,
      );
    }
    return;
  }

  if (first === 'alias' || first === 'aliases') {
    const flags = new Set(rest.filter((arg) => arg.startsWith('--')));
    await aliasCommand(
      apps,
      rest.filter((arg) => !arg.startsWith('--')),
      flags,
    );
    return;
  }

  const { aliases } = await configStore.load();
  const command = first === undefined ? await pick(apps, aliases) : argv;
  if (!command) return;

  const resolved = resolveCommand(command, apps, aliases);
  if (resolved.kind === 'unknown') {
    console.error(`Unknown app or alias "${resolved.name}".\n`);
    process.stderr.write(help(apps));
    process.exitCode = 1;
    return;
  }
  if (resolved.kind === 'loop') {
    console.error(`Alias loop: ${resolved.chain.join(' → ')} — fix it with dev-tools alias`);
    process.exitCode = 1;
    return;
  }
  await runApp(resolved.app, resolved.args);
};

export default run;
