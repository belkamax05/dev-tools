import { homedir } from 'node:os';
import { relative } from 'node:path';
import settingsStore, { ideIdsFor, TAB_IDS, type TabId, withRepoIde } from './config/settings';
import { getInventory, hasDrift, syncInventory } from './core/agents';
import { getHealth } from './core/health';
import { getIde, type IdeDefinition, IDES, mcpTargetsFor } from './core/ides';
import { getInstructions, linkInstructions } from './core/instructions';
import { buildComparisons, readMcpTarget, readSourceMcp, setMcpServer } from './core/mcp';
import findRepoRoot from './core/repo';
import { projectScope, type Scope, userScope } from './core/scope';
import { missingFromLock, restoreSkills } from './core/skills';

const HELP = `agenti — .agents, instructions, MCP servers and skills, kept in step across IDEs

usage:
  agenti [--user]                 open the dashboard (the user scope with --user)
  agenti <tab> [--user]           open it on a tab: ${TAB_IDS.join(', ')}
  agenti ide <id>                 make <id> this repository's primary IDE
  agenti status [--check] [--json] [--user]
                                  where things stand; --check exits 1 on drift, for CI
  agenti sync [--skills] [--quiet] [--user]
                                  make every IDE match .agents wherever that is safe
                                  unattended; --skills also restores skills-lock.json

IDEs: ${IDES.map((ide) => ide.id).join(', ')}
`;

interface IdeReport {
  id: string;
  agents: Record<string, number>;
  instructions: string;
  mcp: Record<string, number>;
  drift: boolean;
}

const mcpCounts = (scope: Scope, ide: IdeDefinition) => {
  const source = readSourceMcp(scope.root);
  const counts: Record<string, number> = {};
  if (scope.kind !== 'project') return counts;
  //? Only the shared, file-based project scope is compared: that is what a
  //? repository owns, and what sync keeps in step
  for (const target of mcpTargetsFor(ide, scope.kind)) {
    if (target.kind !== 'file') continue;
    for (const comparison of buildComparisons(
      source.servers,
      readMcpTarget(scope.root, target).servers,
    )) {
      counts[comparison.status] = (counts[comparison.status] ?? 0) + 1;
    }
  }
  return counts;
};

const report = (scope: Scope, ides: IdeDefinition[]) => {
  const perIde: IdeReport[] = ides.map((ide) => {
    const inventory = getInventory(scope, ide);
    const instructions = getInstructions(scope, ide).status;
    const mcp = mcpCounts(scope, ide);
    return {
      id: ide.id,
      agents: inventory.counts,
      instructions,
      mcp,
      drift:
        hasDrift(inventory) ||
        instructions === 'missing' ||
        instructions === 'mismatch' ||
        Boolean(mcp['missing-in-target']),
    };
  });
  const health = getHealth(scope, ides);
  return {
    scope: scope.kind,
    root: scope.root,
    ides: perIde,
    health: health.map(({ id, severity, title }) => ({ id, severity, title })),
    drift: perIde.some((ide) => ide.drift) || health.some((issue) => issue.severity === 'error'),
  };
};

const printReport = (data: ReturnType<typeof report>) => {
  console.log(`${data.scope.padEnd(8)}${data.root}`);
  for (const ide of data.ides) {
    const a = ide.agents;
    const m = ide.mcp;
    console.log(
      `${(getIde(ide.id)?.name ?? ide.id).padEnd(12)} agents ${a.synced ?? 0} in sync · ${a.mismatch ?? 0} differ · ${a.missing ?? 0} off · ${a.orphan ?? 0} IDE-only` +
        `  · instructions ${ide.instructions}` +
        (Object.keys(m).length
          ? `  · mcp ${m.synced ?? 0} synced · ${m.diff ?? 0} differ · ${m['missing-in-target'] ?? 0} missing`
          : ''),
    );
  }
  const errors = data.health.filter((issue) => issue.severity === 'error').length;
  const warnings = data.health.filter((issue) => issue.severity === 'warn').length;
  console.log(`health      ${errors} error(s) · ${warnings} warning(s)`);
  for (const issue of data.health) console.log(`  ${issue.severity.padEnd(5)} ${issue.title}`);
};

const sync = async (scope: Scope, ides: IdeDefinition[], flags: Set<string>) => {
  const quiet = flags.has('--quiet');
  const say = (line: string) => {
    if (!quiet) console.log(line);
  };
  let changedAny = false;
  const source = readSourceMcp(scope.root);

  for (const ide of ides) {
    const { changed, left } = syncInventory(getInventory(scope, ide));
    for (const path of changed) console.log(`${ide.id}: linked ${path}`);
    for (const path of left)
      say(`${ide.id}: left ${path} — differs or IDE-only; decide in the dashboard`);
    changedAny ||= changed.length > 0;

    const instructions = getInstructions(scope, ide);
    //? Missing, or an import-style file without the import: both safe — the
    //? import goes on top and everything the file already says stays. A
    //? link-style file with content of its own would be replaced, so that one
    //? is left to a person.
    if (
      instructions.status === 'missing' ||
      (instructions.status === 'mismatch' && instructions.mode === 'import')
    ) {
      const result = linkInstructions(instructions);
      console.log(`${ide.id}: ${result.message}`);
      changedAny ||= result.ok;
    } else if (instructions.status === 'mismatch') {
      say(
        `${ide.id}: ${relative(scope.root, instructions.targetPath ?? '')} does not point at AGENTS.md — decide in the dashboard`,
      );
    }

    //? Project files only: a user-scope file is every repository's, and a
    //? repository's sync has no business adding servers to all of them
    if (scope.kind === 'project') {
      for (const target of mcpTargetsFor(ide, scope.kind)) {
        if (target.kind !== 'file' || target.scope !== 'project') continue;
        for (const comparison of buildComparisons(
          source.servers,
          readMcpTarget(scope.root, target).servers,
        )) {
          if (comparison.status !== 'missing-in-target' || !comparison.sourceEntry) continue;
          const result = await setMcpServer(
            scope.root,
            readMcpTarget(scope.root, target),
            comparison.name,
            comparison.sourceEntry,
          );
          console.log(
            `${ide.id}: ${result.ok ? 'added' : 'could not add'} MCP server ${comparison.name}`,
          );
          changedAny ||= result.ok;
        }
      }
    }
  }

  if (flags.has('--skills') && scope.kind === 'project' && missingFromLock(scope.root).length) {
    const result = await restoreSkills(scope.root);
    console.log(
      result.ok
        ? 'restored skills from skills-lock.json'
        : `skills restore failed: ${result.output}`,
    );
  }

  if (!changedAny) say('already in step');
};

/**
 * `agenti [tab | ide <id> | status | sync] [flags]`.
 *
 * The dashboard is imported lazily, as giti does, so the scripted commands
 * never load React or Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const scope = flags.has('--user') ? userScope() : projectScope(findRepoRoot());
  const settings = await settingsStore.load();
  const ides = ideIdsFor(settings, scope.root)
    .map((id) => getIde(id))
    .filter((ide): ide is IdeDefinition => Boolean(ide));

  if (first === 'status') {
    const data = report(scope, ides);
    if (flags.has('--json')) console.log(JSON.stringify(data, null, 2));
    else printReport(data);
    if (flags.has('--check') && data.drift) process.exitCode = 1;
    return;
  }

  if (first === 'sync') return sync(scope, ides, flags);

  if (first === 'ide' && rest[0]) {
    const ide = getIde(rest[0]);
    if (!ide) {
      console.error(
        `Unknown IDE "${rest[0]}" — one of: ${IDES.map((known) => known.id).join(', ')}`,
      );
      process.exitCode = 1;
      return;
    }
    await settingsStore.save(withRepoIde(settings, scope.root, ide.id));
    console.log(
      `${ide.name} is now the primary IDE for ${scope.root === homedir() ? 'the user scope' : scope.root}`,
    );
    return;
  }

  if (first !== undefined && !TAB_IDS.includes(first as TabId)) {
    console.error(`Unknown command "${first}".\n`);
    process.stderr.write(HELP);
    process.exitCode = 1;
    return;
  }

  const { default: renderDashboard } = await import('./ui/renderDashboard');
  await renderDashboard(scope, first as TabId | undefined);
  //? A skills install or an MCP server still starting when the user quit would
  //? otherwise hold the process open with the terminal already handed back
  process.exit(0);
};

export default run;
