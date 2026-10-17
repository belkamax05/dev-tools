import type { Connection, Env, StepConfig, TriggerPlan } from '../plugin';
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
