import { TAB_IDS, type TabId } from './config/settings';
import { type ChainStep, evaluateChain, STATE_ICON } from './core/chain';
import { connectAll } from './core/connection';
import { levelsOf } from './core/graph';
import { evaluateEnvs } from './core/matrix';

import { openSession } from './core/session';
import { planTrigger, sendTrigger } from './core/trigger';

const HELP = `depli — a deploy chain (push → build → deploy → …), each provider a replaceable plugin

usage:
  depli                           open the dashboard
  depli <tab>                     open it on a tab: ${TAB_IDS.join(', ')}
  depli status [--branch=B] [--env=E] [--json]
                                  every step of the chain for a branch and env, and which
                                  one is recommended next
  depli probe [--json]            each provider's transports, probed; the first that works
                                  is the one used
  depli list-branches [glob…] [--json]
                                  branches matching the globs (the config's watch list
                                  when none) with their head commit
  depli where [--json]            what every env runs now, whichever branch — the Envs tab
  depli plan <step> [--branch=B] [--env=E]
                                  the exact request a step's trigger would send — a dry run
  depli trigger <step> [--branch=B] [--env=E] --yes [--confirm-env=E]
                                  send it — refused unless triggers.enabled is on in
                                  depli.config.ts; a protected env needs --confirm-env=<env>

The branch defaults to the pick saved in the dashboard, else the checkout's current branch;
the env to the saved one, else the config's defaultEnv. Secrets come from the environment —
run it under \`envi use\` (or \`dfs deploy\`) to have them there.
`;

const flagValue = (argv: string[], name: string) =>
  argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const printChain = (chain: ChainStep[]) => {
  //? Level number first; steps sharing one run in parallel and say so
  const levels = levelsOf(chain.map((entry) => entry.step));
  const width = new Map<number, number>();
  for (const level of levels.values()) width.set(level, (width.get(level) ?? 0) + 1);
  for (const { step, status, recommended, protected: guarded } of chain) {
    const level = levels.get(step.id) ?? 0;
    const parallel = (width.get(level) ?? 0) > 1 ? ' ∥' : '  ';
    const tag = `${recommended ? ' ← next' : ''}${guarded ? ' [protected]' : ''}`;
    console.log(
      `${level + 1}${parallel} ${STATE_ICON[status.state]} ${step.id.padEnd(14)} ${status.state.padEnd(8)} ${status.summary}${tag}`,
    );
    for (const note of status.notes ?? []) console.log(`       ${note}`);
  }
};

/**
 * `depli [tab | status | connections | branches | plan | trigger] [flags]`.
 *
 * The dashboard is imported lazily, as processi's is, so the scripted commands never load React
 * or Ink.
 */
export const run = async (...argv: string[]) => {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const [first, ...rest] = argv.filter((arg) => !arg.startsWith('--'));
  const json = flags.has('--json');

  if (first === 'help' || flags.has('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  if (first === undefined || TAB_IDS.includes(first as TabId)) {
    const { default: renderDashboard } = await import('./ui/renderDashboard');
    await renderDashboard(first as TabId | undefined);
    process.exit(0);
  }

  const session = await openSession();
  const { project } = session;
  for (const problem of project.problems) console.error(`depli: ${problem}`);
  const branch = flagValue(argv, 'branch') ?? session.branch;
  const targetEnv = flagValue(argv, 'env') ?? session.targetEnv;
  const connections = await connectAll(project, session.env);

  if (first === 'probe') {
    if (json) return void console.log(JSON.stringify(connections, null, 2));
    for (const [name, connection] of Object.entries(connections)) {
      console.log(
        `${connection.transport ? '●' : '○'} ${name}: ${connection.transport ?? 'not connected'}`,
      );
      for (const probe of connection.probes)
        console.log(
          `    ${probe.ok ? '✓' : '✗'} ${probe.label} — ${probe.detail}${probe.identity ? ` (as ${probe.identity})` : ''}`,
        );
    }
    return;
  }

  if (first === 'where') {
    const rows = await evaluateEnvs(project, connections, session.env, branch ?? '');
    if (json) return void console.log(JSON.stringify(rows, null, 2));
    for (const row of rows) {
      console.log(`${row.env}${row.protected ? ' (protected)' : ''}`);
      for (const cell of row.cells) {
        const versions = Object.values(cell.latest.versions ?? {}).join(' ');
        console.log(
          `  ${STATE_ICON[cell.latest.state]} ${cell.step.id.padEnd(10)} ${cell.latest.summary}${cell.latest.branch ? ` · ${cell.latest.branch}` : ''}${versions ? ` · ${versions}` : ''}`,
        );
      }
    }
    return;
  }

  if (first === 'list-branches') {
    const name = project.config.branches?.provider;
    const provider = project.providers.find((entry) =>
      name ? entry.name === name : entry.plugin.branches,
    );
    const connection = provider && connections[provider.name];
    if (!provider?.plugin.branches || !connection?.transport) {
      console.error('depli: no connected provider lists branches');
      process.exitCode = 1;
      return;
    }
    const patterns = rest.length ? rest : (project.config.branches?.watch ?? []);
    const heads = await provider.plugin.branches(
      { cwd: project.dir, env: session.env, options: provider.options, connection },
      connection,
      patterns,
    );
    heads.sort((a, b) => (b.committedAt ?? '').localeCompare(a.committedAt ?? ''));
    if (json) return void console.log(JSON.stringify(heads, null, 2));
    for (const head of heads)
      console.log(
        `${head.sha.slice(0, 8)} ${(head.committedAt ?? '').slice(0, 16).padEnd(16)} ${head.name}${head.name === session.current ? '  (checked out)' : ''}`,
      );
    return;
  }

  if (!branch) {
    console.error('depli: no branch — pass --branch=<name> or set repo.path in depli.config.ts');
    process.exitCode = 1;
    return;
  }
  const chain = await evaluateChain(project, connections, session.env, branch, targetEnv);

  if (first === 'status') {
    if (json) return void console.log(JSON.stringify({ branch, env: targetEnv, chain }, null, 2));
    console.log(
      `${branch} → ${targetEnv}${session.reset ? '  (checkout switched: pick reset to it)' : ''}\n`,
    );
    printChain(chain);
    return;
  }

  if (first === 'plan' || first === 'trigger') {
    const stepId = rest[0];
    if (!stepId) {
      console.error(`usage: depli ${first} <${chain.map((entry) => entry.step.id).join('|')}>`);
      process.exitCode = 1;
      return;
    }
    const planned = await planTrigger(
      project,
      connections,
      session.env,
      chain,
      stepId,
      branch,
      targetEnv,
    ).catch((error: Error) => {
      console.error(`depli: ${error.message}`);
      process.exitCode = 1;
    });
    if (!planned) return;
    console.log(`${planned.plan.method} ${planned.plan.url}`);
    for (const [key, value] of Object.entries(planned.plan.params))
      console.log(`    ${key}=${value}`);
    for (const warning of planned.plan.warnings ?? []) console.log(`  ! ${warning}`);
    if (planned.protected) console.log(`  ! ${targetEnv} is protected — confirm it by name`);
    for (const blocker of planned.blockers) console.log(`  ✗ ${blocker}`);
    for (const fix of planned.plan.fixes ?? [])
      console.log(`  ↳ fix in the dashboard: ${fix.label} — [A] or its button, then Apply`);
    if (first === 'plan') {
      console.log('\n(dry run — nothing was sent)');
      return;
    }
    try {
      const sent = await sendTrigger(project, connections, session.env, planned, {
        confirmed: flags.has('--yes'),
        protectedEnv: flagValue(argv, 'confirm-env'),
        targetEnv,
      });
      console.log(`✓ queued${sent.url ? ` — ${sent.url}` : ''}`);
    } catch (error) {
      console.error(`✗ not sent: ${(error as Error).message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.error(`Unknown command "${first}".\n`);
  process.stderr.write(HELP);
  process.exitCode = 1;
};

export default run;
