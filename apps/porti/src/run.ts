import { loadProjectPorts, mergeWatched } from './config/project';
import {
  configStore,
  parsePort,
  TAB_IDS,
  type TabId,
  type WatchedPort,
  withoutPort,
  withPort,
} from './config/settings';
import { findPortContainers, removeContainers } from './core/docker';
import { describeOwner, getPortStatuses, isBusy, type PortStatus, stopPort } from './core/ports';
import ask, { confirm } from './utils/ask';

const HELP = `porti — what is listening on your ports, and a way to stop it

usage:
  porti                           open the dashboard
  porti <tab>                     open it on a tab: ${TAB_IDS.join(', ')}
  porti list [--all] [--json]     the watched ports and who holds them; --all adds every
                                  other port something is listening on
  porti status [port...] [--json]
                                  who holds each port (default: every watched one) and what
                                  it is for; exits 1 when any of them is taken
  porti kill [port...] [--force] [--tree]
                                  stop whatever listens on each port — SIGTERM, then SIGKILL
                                  after 2s; --force sends SIGKILL at once, --tree stops the
                                  owner's child processes too. No port: pick a busy one
  porti docker-kill [port...] [--yes]
                                  force-remove the Docker containers publishing each port,
                                  after listing them and asking (--yes skips the question)
  porti watch <port> [name...]    add a port to the watched list (or rename it)
  porti unwatch <port...>         remove ports from the watched list
  porti config                    print where the watched ports are kept

A project can list the ports it uses in a porti.config.ts (found in the current folder or
above it, or in $PORTI_PROJECT_DIR): export default { ports: [{ port, name, description }] }.
They are watched alongside your own list.
`;

const pad = (value: string, width: number) => value.padEnd(width);

const label = (status: PortStatus, withDescription: boolean) =>
  withDescription && status.description
    ? `${status.name ?? ''} — ${status.description}`.replace(/^ — /, '')
    : (status.name ?? '');

const printTable = (statuses: PortStatus[], { withDescription = false } = {}) => {
  const nameWidth =
    Math.max(4, ...statuses.map((status) => label(status, withDescription).length)) + 2;
  console.log(
    `${pad('STATE', 8)}${pad('PORT', 7)}${pad('NAME', nameWidth)}${pad('PID', 9)}PROCESS`,
  );
  for (const status of statuses) {
    const state = isBusy(status) ? 'busy' : 'free';
    const lines = status.owners.length
      ? status.owners.map((owner) => [
          String(owner.pid),
          owner.process?.command ?? owner.command ?? '',
        ])
      : [[status.hiddenOwner ? '?' : '–', status.hiddenOwner ? '(another user — try sudo)' : '']];
    lines.forEach(([pid, command], index) => {
      const head =
        index === 0
          ? `${pad(state, 8)}${pad(String(status.port), 7)}${pad(label(status, withDescription), nameWidth)}`
          : ' '.repeat(15 + nameWidth);
      console.log(`${head}${pad(pid ?? '', 9)}${command}`);
    });
  }
};

/** Pull the port numbers out of argv, reporting the ones that are not. */
const portsFrom = (args: string[]): number[] | undefined => {
  const ports: number[] = [];
  for (const arg of args) {
    const port = parsePort(arg);
    if (port === undefined) {
      console.error(`"${arg}" is not a port (1-65535)`);
      process.exitCode = 1;
      return undefined;
    }
    ports.push(port);
  }
  return ports;
};

/**
 * Ask which port to act on: the busy watched ones are offered by number, and any other port can
 * be typed instead. A number no longer than the list picks from it — the list is short and ports
 * that low are never a dev server's. Undefined when the user backs out or answers nothing.
 */
const pickPort = async (busy: PortStatus[], verb: string): Promise<number | undefined> => {
  if (busy.length) {
    console.log(`Busy watched ports:`);
    busy.forEach((status, index) => {
      const who = status.owners.map(describeOwner).join(', ') || 'another user';
      console.log(`  ${index + 1}) ${status.port}${status.name ? ` ${status.name}` : ''} — ${who}`);
    });
  } else console.log('No watched port is busy.');
  const answer = await ask(
    busy.length ? `Port to ${verb} (1-${busy.length}, or any port number): ` : `Port to ${verb}: `,
  );
  if (!answer) return undefined;
  const index = /^\d+$/.test(answer) ? Number(answer) : 0;
  if (index >= 1 && index <= busy.length) return busy[index - 1]?.port;
  const port = parsePort(answer);
  if (port === undefined) {
    console.error(`"${answer}" is not a port (1-65535)`);
    process.exitCode = 1;
  }
  return port;
};

/** The ports named in argv, or — on a terminal, with none named — one the user picks. */
const targetPorts = async (
  args: string[],
  watched: WatchedPort[],
  verb: string,
  usage: string,
): Promise<number[] | undefined> => {
  if (args.length) return portsFrom(args);
  if (!process.stdin.isTTY) {
    console.error(usage);
    process.exitCode = 1;
    return undefined;
  }
  const busy = (await getPortStatuses(watched)).filter(isBusy);
  const port = await pickPort(busy, verb);
  return port === undefined ? undefined : [port];
};

const killPorts = async (ports: number[], flags: Set<string>) => {
  for (const port of ports) {
    const [before] = await getPortStatuses([{ port }]);
    if (!before || !isBusy(before)) {
      console.log(`${port}: free`);
      continue;
    }
    if (!before.owners.length) {
      console.error(`${port}: held by another user's process — run porti with sudo to stop it`);
      process.exitCode = 1;
      continue;
    }
    console.log(`${port}: stopping ${before.owners.map(describeOwner).join(', ')}`);
    const results = await stopPort(port, {
      force: flags.has('--force'),
      tree: flags.has('--tree'),
    });
    for (const result of results) console.log(`  ${result.message}`);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
  }
};

const dockerKillPorts = async (ports: number[], assumeYes: boolean) => {
  for (const port of ports) {
    let containers: Awaited<ReturnType<typeof findPortContainers>>;
    try {
      containers = await findPortContainers(port);
    } catch (error) {
      console.error(`${port}: could not ask Docker — ${(error as Error).message}`);
      process.exitCode = 1;
      continue;
    }
    if (!containers.length) {
      console.log(`${port}: no Docker container publishes it`);
      continue;
    }
    console.log(`${port}: published by`);
    for (const container of containers)
      console.log(
        `  ${container.id}  ${container.name}  ${container.image}  (${container.status})`,
      );

    //? Removing a container cannot be undone, so it is never done without a yes: from the user,
    //? or from --yes when there is no terminal to ask on
    if (!assumeYes) {
      if (!process.stdin.isTTY) {
        console.error('  not a terminal — re-run with --yes to remove them');
        process.exitCode = 1;
        continue;
      }
      if (!(await confirm(`  Force-remove ${containers.length} container(s)?`))) {
        console.log('  left as they are');
        continue;
      }
    }
    try {
      await removeContainers(containers.map((container) => container.id));
      console.log(`  removed ${containers.length} container(s)`);
    } catch (error) {
      console.error(`  ${(error as Error).message}`);
      process.exitCode = 1;
    }
  }
};

/**
 * `porti [tab | list | status | kill | docker-kill | watch | unwatch | config] [flags]`.
 *
 * The dashboard is imported lazily, as giti and agenti do, so the scripted commands never load
 * React or Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('-'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const [config, project] = await Promise.all([configStore.load(), loadProjectPorts()]);
  if (project.error) console.error(`porti: ignoring ${project.path} — ${project.error}`);
  //? Read from, never written back: saving goes through `config.ports` alone, so the project's
  //? ports never leak into the user's own file
  const watched = mergeWatched(config.ports, project.ports);

  if (first === 'list' || first === 'ls') {
    const statuses = await getPortStatuses(watched, { all: flags.has('--all') });
    if (flags.has('--json')) console.log(JSON.stringify(statuses, null, 2));
    else if (!statuses.length) console.log('No ports watched — add one with `porti watch <port>`.');
    else printTable(statuses);
    return;
  }

  if (first === 'status') {
    const ports = rest.length ? portsFrom(rest) : watched.map((entry) => entry.port);
    if (!ports) return;
    const statuses = await getPortStatuses(
      ports.map((port) => watched.find((entry) => entry.port === port) ?? { port }),
    );
    if (flags.has('--json')) console.log(JSON.stringify(statuses, null, 2));
    else printTable(statuses, { withDescription: true });
    if (statuses.some(isBusy)) process.exitCode = 1;
    return;
  }

  if (first === 'kill' || first === 'stop') {
    const ports = await targetPorts(
      rest,
      watched,
      'stop',
      'usage: porti kill <port...> [--force] [--tree]',
    );
    if (ports?.length) await killPorts(ports, flags);
    return;
  }

  if (first === 'docker-kill') {
    const ports = await targetPorts(
      rest,
      watched,
      'free from Docker',
      'usage: porti docker-kill <port...> [--yes]',
    );
    if (ports?.length) await dockerKillPorts(ports, flags.has('--yes') || argv.includes('-y'));
    return;
  }

  if (first === 'watch' || first === 'add') {
    const [portArg, ...nameParts] = rest;
    const port = parsePort(portArg);
    if (port === undefined) {
      console.error('usage: porti watch <port> [name...]');
      process.exitCode = 1;
      return;
    }
    const name = nameParts.join(' ').trim();
    await configStore.save({
      ...config,
      ports: withPort(config.ports, name ? { port, name } : { port }),
    });
    console.log(`Watching ${port}${name ? ` (${name})` : ''} — ${configStore.path}`);
    return;
  }

  if (first === 'unwatch' || first === 'remove' || first === 'rm') {
    const ports = portsFrom(rest);
    if (!ports?.length) {
      if (ports) console.error('usage: porti unwatch <port...>');
      process.exitCode = 1;
      return;
    }
    const next = ports.reduce(withoutPort, config.ports);
    await configStore.save({ ...config, ports: next });
    const fromProject = ports.filter((port) => project.ports.some((entry) => entry.port === port));
    if (fromProject.length)
      console.log(`Still watched by ${project.path}: ${fromProject.join(', ')}`);
    console.log(
      `Watching ${
        mergeWatched(next, project.ports)
          .map((entry) => entry.port)
          .join(', ') || 'nothing'
      }`,
    );
    return;
  }

  if (first === 'config') {
    console.log(configStore.path);
    if (project.path) console.log(`${project.path} (project ports)`);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(first as TabId | undefined, project.ports);
  //? A kill still waiting out its grace period when the user quit would otherwise hold the
  //? process open with the terminal already handed back
  process.exit(0);
};

export default run;
