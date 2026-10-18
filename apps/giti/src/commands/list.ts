import formatColor from '@/dev-tools/utils/format/formatColor';
import type { CommandRun } from '../types/CommandRun';
import getCommandEntries from '../utils/getCommandEntries';

/**
 * Every giti command with what it does, grouped by folder — the same listing the dashboard's
 * Commands palette (`:`) browses and `.gitconfig-commands` is generated from. A word narrows it
 * to the commands whose name or description mention it.
 */
const run: CommandRun = async (args) => {
  const query = args.filter((arg) => !arg.startsWith('-')).join(' ').toLowerCase();
  const entries = (await getCommandEntries()).filter(
    (entry) =>
      !entry.meta?.hidden &&
      (!query ||
        entry.name.toLowerCase().includes(query) ||
        entry.meta?.description.toLowerCase().includes(query)),
  );
  if (entries.length === 0) {
    console.log(`No giti command matches "${query}".`);
    process.exitCode = 1;
    return;
  }

  const width = Math.max(...entries.map((entry) => entry.name.length));
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = entry.name.includes('/') ? entry.name.slice(0, entry.name.indexOf('/')) : '';
    groups.set(group, [...(groups.get(group) ?? []), entry]);
  }

  //? Top-level commands first, then each folder under its own heading
  for (const [group, members] of [...groups].sort(([a], [b]) => (a ? (b ? a.localeCompare(b) : 1) : -1))) {
    console.log(`\n${formatColor(group ? `${group}/` : 'commands', 'catalog')}`);
    for (const { name, meta } of members)
      console.log(`  ${formatColor(name.padEnd(width), 'command')}  ${meta?.description ?? ''}`);
  }
  console.log(
    `\n${formatColor(`${entries.length} commands — giti <name>, or : in the dashboard`, 'info')}`,
  );
};

export const meta = {
  name: 'list',
  description:
    'Every giti command with what it does, grouped by folder — giti list <word> narrows it',
};

export default run;
