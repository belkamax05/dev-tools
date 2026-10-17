import { loadProjectConfig } from './config/project';
import { TAB_IDS, type TabId } from './config/settings';
import { checkTarget, contextFor, resolveTargets } from './core/registry';

const HELP = `depli — deployments, each target a replaceable plugin

usage:
  depli                           open the dashboard
  depli <tab>                     open it on a tab: ${TAB_IDS.join(', ')}
  depli list [--json]             the targets here and whether each is ready
  depli deploy <target> [--dry-run]
                                  deploy through one target's plugin

Targets come from the built-in plugins (jenkins, github) and the nearest depli.config.ts, which
configures them, adds its own and replaces built-ins by id. Secrets are read from the
environment — run it under \`envi use\` (or \`dfs deploy\`) to have them there.
`;

/**
 * `depli [tab | list | deploy] [flags]`.
 *
 * The dashboard is imported lazily, as processi's is, so the scripted commands never load React
 * or Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const project = await loadProjectConfig();
  if (project.error) console.error(`depli: ${project.path}: ${project.error}`);
  const targets = resolveTargets(project.config);
  const base = { cwd: project.dir, env: process.env };

  if (first === 'list' || first === 'ls') {
    const rows = await Promise.all(
      targets.map(async (target) => ({
        id: target.plugin.id,
        label: target.plugin.label,
        checks: await checkTarget(target, base),
      })),
    );
    if (flags.has('--json')) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    for (const row of rows) {
      const ready = row.checks.every((check) => check.ok);
      console.log(`${ready ? '●' : '○'} ${row.id.padEnd(10)} ${ready ? 'ready' : 'not ready'}`);
      for (const check of row.checks)
        console.log(
          `    ${check.ok ? '✓' : '✗'} ${check.label}${check.detail ? ` — ${check.detail}` : ''}`,
        );
    }
    return;
  }

  if (first === 'deploy') {
    const target = targets.find((entry) => entry.plugin.id === rest[0]);
    if (!target) {
      console.error(`usage: depli deploy <${targets.map((entry) => entry.plugin.id).join('|')}>`);
      process.exitCode = 1;
      return;
    }
    const context = { ...base, dryRun: flags.has('--dry-run'), log: console.log };
    const failed = (await checkTarget(target, context)).filter((check) => !check.ok);
    if (failed.length) {
      for (const check of failed)
        console.error(`✗ ${check.label} — ${check.detail ?? 'not ready'}`);
      process.exitCode = 1;
      return;
    }
    const result = await target.plugin.deploy(contextFor(target, context));
    console.log(
      `${result.ok ? '✓' : '✗'} ${result.message}${result.url ? ` — ${result.url}` : ''}`,
    );
    if (!result.ok) process.exitCode = 1;
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

export default run;
