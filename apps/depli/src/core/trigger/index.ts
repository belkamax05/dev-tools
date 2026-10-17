import type { Connection, Env, StepConfig, StepRun, TriggerPlan } from '../plugin';
import type { ChainStep } from '../chain';
import { contextFor, type Project } from '../registry';

export interface PlannedTrigger {
  step: StepConfig;
  plan: TriggerPlan;
  /** Why it may not be sent — empty when the gate is open. */
  blockers: string[];
  protected: boolean;
}

/** The dry run: the exact request a step's trigger would send. Never sends anything. */
export const planTrigger = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  chain: ChainStep[],
  stepId: string,
  branch: string,
  targetEnv: string,
): Promise<PlannedTrigger> => {
  const entry = chain.find((item) => item.step.id === stepId);
  if (!entry) throw new Error(`no step ${stepId} for ${targetEnv}`);
  const { step } = entry;
  const provider = project.providers.find((item) => item.name === step.provider);
  const kind = provider?.plugin.steps[step.kind];
  if (!provider || !kind?.plan) throw new Error(`${step.label} is observe-only`);
  const upstream = Object.fromEntries(
    chain
      .filter((item) => (step.after ?? []).includes(item.step.id))
      .map((item) => [item.step.id, item.status]),
  );
  const connection = connections[step.provider];
  const plan = await kind.plan(contextFor(project, provider, env, connection), {
    step,
    branch,
    env: targetEnv,
    upstream,
  });
  const blockers: string[] = [];
  if (!project.config.triggers?.enabled)
    blockers.push('triggers are off (triggers.enabled in depli.config.ts)');
  if (!connection?.capabilities.includes('trigger'))
    blockers.push(`${provider.name}'s connection cannot trigger`);
  if (entry.status.state === 'running') blockers.push('already running');
  if (['missing', 'offline', 'error'].includes(entry.status.state))
    blockers.push(`step is ${entry.status.state}: ${entry.status.summary}`);
  blockers.push(...(plan.blockers ?? []));
  if (plan.warnings?.some((warning) => warning.includes('no successful build')))
    blockers.push('missing input from an earlier step');
  return { step, plan, blockers, protected: entry.protected };
};

/**
 * The only path to a provider's `send`. Refuses unless triggers are enabled, nothing blocks the
 * plan and the caller passes the confirmation — and a protected env must be confirmed by its own
 * name, so a generic "yes" never deploys to it.
 */
export const sendTrigger = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  planned: PlannedTrigger,
  confirmation: { confirmed: boolean; protectedEnv?: string; targetEnv: string },
) => {
  if (planned.blockers.length) throw new Error(planned.blockers.join('; '));
  if (!confirmation.confirmed) throw new Error('not confirmed');
  if (planned.protected && confirmation.protectedEnv !== confirmation.targetEnv)
    throw new Error(`${confirmation.targetEnv} is protected: confirm by typing its name`);
  const provider = project.providers.find((item) => item.name === planned.step.provider);
  const kind = provider?.plugin.steps[planned.step.kind];
  if (!provider || !kind?.send) throw new Error(`${planned.step.label} cannot be triggered`);
  return kind.send(contextFor(project, provider, env, connections[provider.name]), planned.plan);
};

/**
 * The only path to a provider's `fix`: a change on the target (a job's configuration) that lifts
 * one of the plan's blockers. Refused unless triggers are enabled and the connection may write,
 * and unless the caller confirmed it — the UI asks with an Apply button beside what changes.
 */
export const applyFix = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  planned: PlannedTrigger,
  fixId: string,
  confirmed: boolean,
): Promise<string> => {
  const fix = planned.plan.fixes?.find((item) => item.id === fixId);
  if (!fix) throw new Error(`no fix ${fixId} for ${planned.step.label}`);
  if (!project.config.triggers?.enabled)
    throw new Error('triggers are off (triggers.enabled in depli.config.ts)');
  const provider = project.providers.find((item) => item.name === planned.step.provider);
  const kind = provider?.plugin.steps[planned.step.kind];
  const connection = provider && connections[provider.name];
  if (!provider || !kind?.fix) throw new Error(`${planned.step.label} cannot be fixed from here`);
  if (!connection?.capabilities.includes('trigger'))
    throw new Error(`${provider.name}'s connection cannot write`);
  if (!confirmed) throw new Error('not confirmed');
  return kind.fix(contextFor(project, provider, env, connection), planned.plan, fixId);
};

/**
 * The only path to a provider's `stop`: aborts a run that is running now. Refused unless
 * triggers are enabled, the connection may write, the run is running and the caller confirmed —
 * and in a protected env, confirmed by typing its name, as a trigger is.
 */
export const stopRun = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  entry: ChainStep,
  run: StepRun,
  input: { branch: string; targetEnv: string },
  confirmation: { confirmed: boolean; protectedEnv?: string },
): Promise<string> => {
  if (!project.config.triggers?.enabled)
    throw new Error('triggers are off (triggers.enabled in depli.config.ts)');
  const provider = project.providers.find((item) => item.name === entry.step.provider);
  const kind = provider?.plugin.steps[entry.step.kind];
  const connection = provider && connections[provider.name];
  if (!provider || !kind?.stop) throw new Error(`${entry.step.label} cannot be stopped from here`);
  if (!connection?.capabilities.includes('trigger'))
    throw new Error(`${provider.name}'s connection cannot write`);
  if (run.state !== 'running') throw new Error(`${run.label} is not running`);
  if (!confirmation.confirmed) throw new Error('not confirmed');
  if (entry.protected && confirmation.protectedEnv !== input.targetEnv)
    throw new Error(`${input.targetEnv} is protected: confirm by typing its name`);
  return kind.stop(
    contextFor(project, provider, env, connection),
    { step: entry.step, branch: input.branch, env: input.targetEnv, upstream: {} },
    run,
  );
};
