import { relative } from 'node:path';

import settingsStore, { resolveIdeId, TAB_IDS, type TabId, withRepoIde } from '../config/settings';
import { getInventory } from '../core/agents';
import { getIde, IDES } from '../core/ides';
import { buildComparisons, readSourceMcp, readTargetMcp } from '../core/mcp';
import findRepoRoot from '../core/repo';

const HELP = `agenti — .agents, MCP servers and skills for the repository you are in

usage:
  agenti                 open the dashboard
  agenti <tab>           open it on a tab: ${TAB_IDS.join(', ')}
  agenti ide <id>        set this repository's IDE without opening anything
  agenti status          print where this repository stands, and exit

IDEs: ${IDES.map((ide) => ide.id).join(', ')}
`;

/** One screen of plain text, for scripts and for a quick look without the TUI. */
const printStatus = async (root: string) => {
  const settings = await settingsStore.load();
  const ide = getIde(resolveIdeId(settings, root));
  if (!ide) return;
  const inventory = getInventory(root, ide);
  const { counts } = inventory;

  console.log(`repo    ${root}`);
  console.log(`ide     ${ide.name} (${ide.id}) · .agents → ${ide.folder} · ${inventory.mode}`);
  console.log(
    `agents  ${counts.synced} in sync · ${counts.mismatch} differ · ${counts.missing} off · ${counts.orphan} IDE-only`,
  );

  const target = readTargetMcp(root, ide);
  if (target) {
    const source = readSourceMcp(root);
    const comparisons = buildComparisons(source.servers, target.servers);
    const count = (status: string) => comparisons.filter((c) => c.status === status).length;
    console.log(
      `mcp     ${count('synced')} synced · ${count('diff')} differ · ${count('missing-in-target')} not in IDE · ${count('target-only')} IDE-only` +
        `  (${source.exists ? relative(root, source.path) : 'no reference'})`,
    );
  }
};

/**
 * `agenti [tab | ide <id> | status]`.
 *
 * The dashboard is imported lazily, as giti does, so `agenti status` and
 * `agenti ide <id>` never load React or Ink.
 */
export const run = async (...[first, ...rest]: string[]) => {
  if (first === '-h' || first === '--help' || first === 'help') {
    process.stdout.write(HELP);
    return;
  }

  const root = findRepoRoot();

  if (first === 'status') return printStatus(root);

  if (first === 'ide' && rest[0]) {
    const ide = getIde(rest[0]);
    if (!ide) {
      console.error(
        `Unknown IDE "${rest[0]}" — one of: ${IDES.map((known) => known.id).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    await settingsStore.save(withRepoIde(await settingsStore.load(), root, ide.id));
    console.log(`${ide.name} is now the IDE for ${root}`);
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('../ui/renderDashboard');
  await renderDashboard(root, first as TabId | undefined);
  //? A skills install or an MCP server still starting when the user quit would
  //? otherwise hold the process open with the terminal already handed back
  process.exit(0);
};

export default run;
