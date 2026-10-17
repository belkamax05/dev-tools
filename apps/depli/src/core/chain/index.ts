import type { Connection, Env, StepConfig, StepState, StepStatus } from '../plugin';
import { contextFor, type Project } from '../registry';

export interface ChainStep {
  step: StepConfig;
  status: StepStatus;
  /** Behind, with everything before it current — a step to run next (there may be several). */
  recommended: boolean;
  /** The env is protected: never auto-proceeds, always its own confirmation. */
  protected: boolean;
}

/** The pipeline's steps that apply to `env`, in config order. */
export const stepsFor = (project: Project, env: string) =>
  (project.config.pipeline ?? []).filter((step) => !step.envs || step.envs.includes(env));

/**
 * Does the step act on the env (deploy, propagate) rather than on the branch (build)? Only those
 * are guarded in a protected env — building a branch never touches it.
 */
export const isEnvScoped = (step: StepConfig) =>
  Boolean(step.envs) ||
  Object.values(step).some((value) => typeof value === 'string' && value.includes('{env}'));

export const isProtectedEnv = (project: Project, env: string) =>
  Boolean(project.config.envs?.find((entry) => entry.id === env)?.protected);

/**
 * Evaluate the chain for a branch and env, step by step: each step sees its `after` steps'
 * statuses and compares against them. A step whose upstream has nothing to compare (failed,
 * offline, never ran) is `blocked`, not guessed at.
 */
export const evaluateChain = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  branch: string,
  targetEnv: string,
  onStep?: (steps: ChainStep[]) => void,
): Promise<ChainStep[]> => {
  const done: Record<string, StepStatus> = {};
  const result: ChainStep[] = [];
  const isProtected = isProtectedEnv(project, targetEnv);
  for (const step of stepsFor(project, targetEnv)) {
    const provider = project.providers.find((entry) => entry.name === step.provider);
    const kind = provider?.plugin.steps[step.kind];
    const connection = connections[step.provider];
    const upstream = Object.fromEntries(
      (step.after ?? []).filter((id) => done[id]).map((id) => [id, done[id] as StepStatus]),
    );
    let status: StepStatus;
    if (!provider || !kind)
      status = { state: 'error', summary: `not configured (${step.provider}/${step.kind})` };
    else if (!connection?.transport)
      status = { state: 'offline', summary: `${provider.name} is not connected` };
    else {
      try {
        status = await kind.status(contextFor(project, provider, env, connection), {
          step,
          branch,
          env: targetEnv,
          upstream,
        });
      } catch (error) {
        status = { state: 'error', summary: (error as Error).message };
      }
      const waiting = Object.entries(upstream).filter(([, entry]) => !entry.ref);
      if (waiting.length && (status.state === 'done' || status.state === 'stale'))
        status = {
          ...status,
          state: 'blocked',
          notes: [`waiting on ${waiting.map(([id]) => id).join(', ')}`, ...(status.notes ?? [])],
        };
    }
    done[step.id] = status;
    result.push({ step, status, recommended: false, protected: isProtected && isEnvScoped(step) });
    onStep?.([...result]);
  }
  //? Recommend every step that is behind while everything it depends on is current — the
  //? frontier: two builds after the same push are recommended together, they can run in parallel
  for (const entry of result) {
    entry.recommended =
      (entry.status.state === 'stale' || entry.status.state === 'none') &&
      (entry.step.after ?? []).every((id) => done[id]?.state === 'done');
  }
  return result;
};

/** One glyph per state — the CLI and the dashboard draw the same ones. */
export const STATE_ICON: Record<StepState, string> = {
  done: '✓',
  stale: '↻',
  running: '◐',
  failed: '✗',
  none: '·',
  blocked: '…',
  offline: '⊘',
  missing: '?',
  error: '!',
};
