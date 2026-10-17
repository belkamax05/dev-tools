import { isEnvScoped, stepsFor } from '../chain';
import type { Connection, Env, LatestRun, StepConfig } from '../plugin';
import { contextFor, type Project } from '../registry';

export interface EnvCell {
  step: StepConfig;
  latest: LatestRun;
}

export interface EnvRow {
  env: string;
  protected: boolean;
  /** One cell per env-scoped step (deploy, propagate…), in pipeline order. */
  cells: EnvCell[];
}

/**
 * What every env is running right now: for each env, the latest run of each step that acts on
 * it, whichever branch that run was for. Read-only, like everything else outside the gate.
 */
export const evaluateEnvs = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  branch: string,
): Promise<EnvRow[]> =>
  Promise.all(
    (project.config.envs ?? []).map(async (entry) => {
      const steps = stepsFor(project, entry.id).filter(isEnvScoped);
      const cells = await Promise.all(
        steps.map(async (step): Promise<EnvCell> => {
          const provider = project.providers.find((item) => item.name === step.provider);
          const kind = provider?.plugin.steps[step.kind];
          const connection = connections[step.provider];
          if (!provider || !kind?.latest)
            return { step, latest: { state: 'error', summary: 'cannot read' } };
          if (!connection?.transport)
            return { step, latest: { state: 'offline', summary: `${provider.name} offline` } };
          try {
            return {
              step,
              latest: await kind.latest(contextFor(project, provider, env, connection), {
                step,
                branch,
                env: entry.id,
                upstream: {},
              }),
            };
          } catch (error) {
            return { step, latest: { state: 'error', summary: (error as Error).message } };
          }
        }),
      );
      return { env: entry.id, protected: Boolean(entry.protected), cells };
    }),
  );
