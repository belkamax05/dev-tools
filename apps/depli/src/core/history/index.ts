import type { EnvConfig } from '../../config/project';
import { isEnvScoped, stepsFor } from '../chain';
import type { EnvRow } from '../matrix';
import {
  type Connection,
  type Env,
  type HistoryRun,
  type JobHistory,
  matchesPatterns,
  type StepConfig,
} from '../plugin';
import { contextFor, inputFor, type Project } from '../registry';

/** One step's jobs and their runs — or why they could not be read. */
export interface StepHistory {
  step: StepConfig;
  jobs: JobHistory[];
  error?: string;
}

export interface EnvHistory {
  env: string;
  /** The env-scoped steps (deploy, propagate…), in pipeline order. */
  steps: StepHistory[];
}

/** Everything the Environments window's detailed view shows, read in one go. */
export interface History {
  /** Steps that are not env-scoped (the builds) — the same jobs for every env, read once. */
  shared: StepHistory[];
  envs: EnvHistory[];
  /**
   * Steps whose history is per branch (`historyByBranch` — a branch's commits), by the branch:
   * read for every branch an env runs, and the one the dashboard shows.
   */
  branches: Record<string, StepHistory[]>;
  readAt: number;
}

const readStep = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  step: StepConfig,
  branch: string,
  targetEnv: string,
): Promise<StepHistory> => {
  const provider = project.providers.find((item) => item.name === step.provider);
  const kind = provider?.plugin.steps[step.kind];
  const connection = connections[step.provider];
  if (!provider || !kind) return { step, jobs: [], error: 'not configured' };
  //? Observe-only steps (a push) have no jobs to list — not an error
  if (!kind.history) return { step, jobs: [] };
  if (!connection?.transport) return { step, jobs: [], error: `${provider.name} offline` };
  try {
    const jobs = await kind.history(
      contextFor(project, provider, env, connection),
      inputFor(project, step, branch, targetEnv),
    );
    return { step, jobs };
  } catch (error) {
    return { step, jobs: [], error: (error as Error).message };
  }
};

/** The branch each env-scoped job last ran successfully — what the envs run, from their own history. */
export const deployedBranches = (envs: readonly EnvHistory[]) =>
  envs.flatMap((entry) =>
    entry.steps.flatMap((step) =>
      step.jobs.flatMap((job) => {
        const branch = job.runs.find((run) => run.state === 'success' && run.branch)?.branch;
        return branch ? [branch] : [];
      }),
    ),
  );

/**
 * Every job of every step and their recent runs: the shared steps once, each env's env-scoped
 * steps per env, then the per-branch steps (a branch's commits) for `branches`, `branch` and every
 * branch an env's jobs last deployed. Read-only, like everything outside the trigger gate.
 */
export const readHistory = async (
  project: Project,
  connections: Record<string, Connection>,
  env: Env,
  branch: string,
  targetEnv: string,
  branches: readonly string[] = [],
): Promise<History> => {
  const byBranch = (step: StepConfig) => {
    const provider = project.providers.find((item) => item.name === step.provider);
    return Boolean(provider?.plugin.steps[step.kind]?.historyByBranch);
  };
  const pipeline = project.config.pipeline ?? [];
  const shared = pipeline.filter((step) => !isEnvScoped(step) && !byBranch(step));
  const perBranch = pipeline.filter((step) => !isEnvScoped(step) && byBranch(step));
  const [sharedHistory, envs] = await Promise.all([
    Promise.all(shared.map((step) => readStep(project, connections, env, step, branch, targetEnv))),
    Promise.all(
      (project.config.envs ?? []).map(async (entry) => ({
        env: entry.id,
        steps: await Promise.all(
          stepsFor(project, entry.id)
            .filter(isEnvScoped)
            .map((step) => readStep(project, connections, env, step, branch, entry.id)),
        ),
      })),
    ),
  ]);
  const names = [...new Set([branch, ...branches, ...deployedBranches(envs)].filter(Boolean))];
  const read = await Promise.all(
    names.map(
      async (name) =>
        [
          name,
          await Promise.all(
            perBranch.map((step) => readStep(project, connections, env, step, name, targetEnv)),
          ),
        ] as const,
    ),
  );
  return { shared: sharedHistory, envs, branches: Object.fromEntries(read), readAt: Date.now() };
};

// --- what the views derive from it ------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Mon 19 Oct 2026` — a day heading, in the machine's own timezone. */
export const dayLabel = (at: number) => {
  const date = new Date(at);
  return `${WEEKDAYS[date.getDay()]} ${String(date.getDate()).padStart(2, '0')} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

/** Runs grouped by the day they started, newest day first; runs keep their order inside a day. */
export const runsByDay = (
  runs: readonly HistoryRun[],
): Array<{ day: string; runs: HistoryRun[] }> => {
  const days: Array<{ day: string; runs: HistoryRun[] }> = [];
  for (const run of runs) {
    const day = run.at ? dayLabel(run.at) : 'unknown day';
    const last = days.at(-1);
    if (last?.day === day) last.runs.push(run);
    else days.push({ day, runs: [run] });
  }
  return days;
};

/** The build number a version value ends in — `1.0.x-release-26-13.1008` → 1008. */
export const versionNumber = (value: string | undefined) => {
  const match = value?.match(/\.(\d+)$/);
  return match ? Number(match[1]) : undefined;
};

/** A run of a shared step by its build number, when the history still has it. */
export const findRun = (history: History | undefined, stepId: string, number: number) => {
  const step = history?.shared.find((entry) => entry.step.id === stepId);
  for (const job of step?.jobs ?? []) {
    const run = job.runs.find((candidate) => candidate.id === String(number));
    if (run) return run;
  }
  return undefined;
};

/** What a run deployed: per version param, the build step it names and the build number. */
export const versionsOf = (step: StepConfig, run: Pick<HistoryRun, 'params'>) =>
  Object.entries((step.versions ?? {}) as Record<string, string>).map(([param, stepId]) => ({
    param,
    stepId,
    value: run.params?.[param],
    number: versionNumber(run.params?.[param]),
  }));

/**
 * Which envs run each build now — `build-nginx` #1008 → [ci, uat3] — from what every env's
 * deploy step last put there. The relation from a build job to the envs it reached.
 */
export const deployedBuilds = (rows: readonly EnvRow[]) => {
  const result = new Map<string, Map<number, string[]>>();
  for (const row of rows)
    for (const cell of row.cells)
      for (const [param, stepId] of Object.entries(
        (cell.step.versions ?? {}) as Record<string, string>,
      )) {
        const number = versionNumber(cell.latest.versions?.[param]);
        if (number === undefined) continue;
        const byNumber = result.get(stepId) ?? new Map<number, string[]>();
        byNumber.set(number, [...(byNumber.get(number) ?? []), row.env]);
        result.set(stepId, byNumber);
      }
  return result;
};

/** The branch an env runs now: what its branch-recording step last ran. */
export const runningBranch = (row: EnvRow | undefined) =>
  row?.cells.find((cell) => cell.latest.branch !== undefined)?.latest.branch;

/** Whether the env runs a branch it is meant to — undefined when the config says nothing. */
export const onTrack = (entry: Pick<EnvConfig, 'branches'> | undefined, branch?: string) =>
  entry?.branches?.length && branch ? matchesPatterns(branch, entry.branches) : undefined;

export interface BranchRelation {
  /** A configured pattern (`develop`, `release-*`), or a branch only seen running. */
  branch: string;
  /** Envs whose config names it. */
  tracks: string[];
  /** Envs running a branch it matches now. */
  runs: string[];
}

/**
 * Branches and envs as a graph's edges: every pattern from `envs[].branches` with the envs that
 * should run it and the ones that do, then every running branch no pattern covers. Envs sharing
 * a node run (or should run) the same code.
 */
export const branchRelations = (
  envs: readonly EnvConfig[],
  rows: readonly EnvRow[],
): BranchRelation[] => {
  const running = new Map(rows.map((row) => [row.env, runningBranch(row)]));
  const relations: BranchRelation[] = [];
  for (const entry of envs)
    for (const pattern of entry.branches ?? []) {
      if (pattern.startsWith('!')) continue;
      let relation = relations.find((item) => item.branch === pattern);
      if (!relation) {
        relation = { branch: pattern, tracks: [], runs: [] };
        relations.push(relation);
      }
      relation.tracks.push(entry.id);
    }
  for (const relation of relations)
    relation.runs = envs
      .filter((entry) => {
        const branch = running.get(entry.id);
        return branch !== undefined && matchesPatterns(branch, [relation.branch]);
      })
      .map((entry) => entry.id);
  const covered = new Set(relations.flatMap((relation) => relation.runs));
  for (const entry of envs) {
    const branch = running.get(entry.id);
    if (!branch || covered.has(entry.id)) continue;
    let relation = relations.find((item) => item.branch === branch);
    if (!relation) {
      relation = { branch, tracks: [], runs: [] };
      relations.push(relation);
    }
    relation.runs.push(entry.id);
  }
  return relations;
};
