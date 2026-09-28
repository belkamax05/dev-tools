import { TAB_IDS, type TabId } from './config/settings';
import {
  formatRss,
  getSnapshot,
  primeCpu,
  SCOPES,
  type Scope,
  SORT_KEYS,
  type SortKey,
  stopPids,
} from './core/processes';

const HELP = `processi — the process table, and a way to stop what is in it

usage:
  processi                        open the dashboard
  processi <tab>                  open it on a tab: ${TAB_IDS.join(', ')}
  processi list [text] [--sort=${SORT_KEYS.join('|')}] [--mine | --here]
                [--tree] [--limit=N] [--json]
                                  processes matching text (pid, name, command or user);
                                  --here keeps the ones working inside the current folder
  processi kill <pid...> [--force] [--tree]
                                  SIGTERM, then SIGKILL after 2s; --force sends SIGKILL at
                                  once, --tree stops each one's child processes too
`;

const flagValue = (flags: string[], name: string) =>
  flags.find((flag) => flag.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * `processi [tab | list | kill] [flags]`.
 *
 * The dashboard is imported lazily, as giti and agenti do, so the scripted commands never load
 * React or Ink.
 */
export const run = async (...argv: string[]) => {
  const flagList = argv.filter((arg) => arg.startsWith('--'));
  const flags = new Set(flagList);
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  if (first === 'list' || first === 'ls' || first === 'find') {
    const sort = (flagValue(flagList, 'sort') ?? 'cpu') as SortKey;
    if (!SORT_KEYS.includes(sort)) {
      console.error(`--sort must be one of ${SORT_KEYS.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    const scope: Scope = flags.has('--here') ? 'here' : flags.has('--mine') ? 'mine' : 'all';
    //? Two samples a moment apart, so CPU is what each process is using now — see withLiveCpu
    if (sort === 'cpu') {
      await primeCpu();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const { rows } = await getSnapshot({
      scope,
      sort,
      query: rest.join(' '),
      tree: flags.has('--tree'),
      root: process.cwd(),
    });
    const limit = Number(flagValue(flagList, 'limit') ?? (flags.has('--json') ? 0 : 40));
    const shown = limit > 0 ? rows.slice(0, limit) : rows;
    if (flags.has('--json')) {
      console.log(JSON.stringify(shown, null, 2));
      return;
    }
    const width = process.stdout.isTTY ? process.stdout.columns : 0;
    console.log(
      `${'PID'.padStart(7)} ${'CPU%'.padStart(6)} ${'MEM'.padStart(6)} ${'USER'.padEnd(9)}COMMAND`,
    );
    for (const row of shown) {
      const line = `${String(row.pid).padStart(7)} ${row.cpu.toFixed(1).padStart(6)} ${formatRss(row.rss).padStart(6)} ${row.user.slice(0, 8).padEnd(9)}${'  '.repeat(row.depth)}${row.command}`;
      console.log(width ? line.slice(0, width) : line);
    }
    if (shown.length < rows.length) {
      console.log(`… ${rows.length - shown.length} more — --limit=0 shows everything`);
    }
    return;
  }

  if (first === 'kill' || first === 'stop') {
    const pids = rest.map(Number);
    if (!pids.length || pids.some((pid) => !Number.isInteger(pid) || pid <= 0)) {
      console.error('usage: processi kill <pid...> [--force] [--tree]');
      process.exitCode = 1;
      return;
    }
    const results = await stopPids(pids, {
      force: flags.has('--force'),
      tree: flags.has('--tree'),
    });
    for (const result of results) console.log(result.message);
    if (results.some((result) => !result.ok)) process.exitCode = 1;
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
  process.exit(0);
};

export { SCOPES };
export default run;
