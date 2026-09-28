import {
  configStore,
  parsePort,
  TAB_IDS,
  type TabId,
  withoutPort,
  withPort,
} from './config/settings';
import { describeOwner, getPortStatuses, isBusy, type PortStatus, stopPort } from './core/ports';

const HELP = `porti — what is listening on your ports, and a way to stop it

usage:
  porti                           open the dashboard
  porti <tab>                     open it on a tab: ${TAB_IDS.join(', ')}
  porti list [--all] [--json]     the watched ports and who holds them; --all adds every
                                  other port something is listening on
  porti status <port...> [--json]
                                  who holds each port; exits 1 when any of them is taken
  porti kill <port...> [--force] [--tree]
                                  stop whatever listens on each port — SIGTERM, then SIGKILL
                                  after 2s; --force sends SIGKILL at once, --tree stops the
                                  owner's child processes too
  porti watch <port> [name...]    add a port to the watched list (or rename it)
  porti unwatch <port...>         remove ports from the watched list
  porti config                    print where the watched ports are kept
`;

const pad = (value: string, width: number) => value.padEnd(width);

const printTable = (statuses: PortStatus[]) => {
  const nameWidth = Math.max(4, ...statuses.map((status) => (status.name ?? '').length)) + 2;
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
          ? `${pad(state, 8)}${pad(String(status.port), 7)}${pad(status.name ?? '', nameWidth)}`
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
 * `porti [tab | list | status | kill | watch | unwatch | config] [flags]`.
 *
 * The dashboard is imported lazily, as giti and agenti do, so the scripted commands never load
 * React or Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const config = await configStore.load();

  if (first === 'list' || first === 'ls') {
    const statuses = await getPortStatuses(config.ports, { all: flags.has('--all') });
    if (flags.has('--json')) console.log(JSON.stringify(statuses, null, 2));
    else if (!statuses.length) console.log('No ports watched — add one with `porti watch <port>`.');
    else printTable(statuses);
    return;
  }

  if (first === 'status') {
    const ports = rest.length ? portsFrom(rest) : config.ports.map((entry) => entry.port);
    if (!ports) return;
    const statuses = await getPortStatuses(
      ports.map((port) => config.ports.find((entry) => entry.port === port) ?? { port }),
    );
    if (flags.has('--json')) console.log(JSON.stringify(statuses, null, 2));
    else printTable(statuses);
    if (statuses.some(isBusy)) process.exitCode = 1;
    return;
  }

  if (first === 'kill' || first === 'stop') {
    const ports = portsFrom(rest);
    if (!ports) return;
    if (!ports.length) {
      console.error('usage: porti kill <port...> [--force] [--tree]');
      process.exitCode = 1;
      return;
    }
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
    console.log(`Watching ${next.map((entry) => entry.port).join(', ') || 'nothing'}`);
    return;
  }

  if (first === 'config') {
    console.log(configStore.path);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(first as TabId | undefined);
  //? A kill still waiting out its grace period when the user quit would otherwise hold the
  //? process open with the terminal already handed back
  process.exit(0);
};

export default run;
