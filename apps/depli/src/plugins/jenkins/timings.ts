import type { Env, RunTimings, StageTiming } from '../../core/plugin';
import { JenkinsError, type JenkinsOptions, jenkinsAuth, jobPath } from './api';

export interface WorkflowStage {
  id: string;
  name: string;
  status: string;
  durationMillis: number;
  startTimeMillis?: number;
}
export interface WorkflowRun {
  durationMillis?: number;
  startTimeMillis?: number;
  endTimeMillis?: number;
  id: string;
  status: string;
  stages: WorkflowStage[];
}
const active = (status: string) =>
  ['IN_PROGRESS', 'PAUSED_PENDING_INPUT', 'QUEUED'].includes(status);
const stageState = (status: string): StageTiming['state'] =>
  (({
    SUCCESS: 'success',
    FAILED: 'failure',
    UNSTABLE: 'failure',
    ABORTED: 'aborted',
    IN_PROGRESS: 'running',
    PAUSED_PENDING_INPUT: 'paused',
    NOT_EXECUTED: 'skipped',
    QUEUED: 'pending',
  })[status] as StageTiming['state'] | undefined) ?? 'other';

// Node ids change between builds; pair stages by name and occurrence, including parallel stages.
const keyed = (stages: WorkflowStage[]) => {
  const counts = new Map<string, number>();
  return stages.map((stage) => {
    const occurrence = counts.get(stage.name) ?? 0;
    counts.set(stage.name, occurrence + 1);
    return { key: `${stage.name}\0${occurrence}`, stage };
  });
};
export const compareTimings = (
  current: WorkflowRun,
  history: WorkflowRun[],
  now = Date.now(),
): RunTimings => {
  const previous = history
    .filter((run) => Number(run.id) < Number(current.id) && run.status === 'SUCCESS')
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 5);
  const averages = new Map<string, number[]>();
  for (const run of previous)
    for (const { key, stage } of keyed(run.stages)) {
      if (stage.status !== 'SUCCESS' || !Number.isFinite(stage.durationMillis)) continue;
      const values = averages.get(key) ?? [];
      values.push(stage.durationMillis);
      averages.set(key, values);
    }
  const actual = keyed(current.stages);
  const stages: StageTiming[] = actual.map(({ key, stage }) => {
    const samples = averages.get(key) ?? [];
    const state = stageState(stage.status);
    const elapsed =
      state === 'running' && stage.startTimeMillis
        ? Math.max(stage.durationMillis, now - stage.startTimeMillis)
        : stage.durationMillis;
    return {
      id: key,
      label: stage.name,
      state,
      durationMs: Math.max(0, elapsed),
      averageMs: samples.length
        ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
        : undefined,
      samples: samples.length,
    };
  });
  // Jenkins reports reached stages only. Show the last successful run's remaining stages as pending.
  if (active(current.status))
    for (const { key, stage } of keyed(previous[0]?.stages ?? [])) {
      if (actual.some((item) => item.key === key)) continue;
      const samples = averages.get(key) ?? [];
      stages.push({
        id: key,
        label: stage.name,
        state: 'pending',
        averageMs: samples.length
          ? Math.round(samples.reduce((sum, value) => sum + value, 0) / samples.length)
          : undefined,
        samples: samples.length,
      });
    }
  // Use whole-run wall-clock durations, never a sum of stages (parallel stages overlap).
  const wholeDuration = (run: WorkflowRun) =>
    run.durationMillis && run.durationMillis > 0
      ? run.durationMillis
      : run.startTimeMillis && run.endTimeMillis && run.endTimeMillis > run.startTimeMillis
        ? run.endTimeMillis - run.startTimeMillis
        : undefined;
  const totals = previous
    .map(wholeDuration)
    .filter((value): value is number => value !== undefined);
  const elapsedMs =
    active(current.status) && current.startTimeMillis
      ? Math.max(0, now - current.startTimeMillis)
      : wholeDuration(current);
  const estimatedTotalMs = totals.length
    ? Math.round(totals.reduce((sum, value) => sum + value, 0) / totals.length)
    : undefined;
  return {
    stages,
    state: active(current.status)
      ? 'running'
      : current.status === 'SUCCESS'
        ? 'success'
        : current.status === 'ABORTED'
          ? 'aborted'
          : current.status === 'FAILED' || current.status === 'UNSTABLE'
            ? 'failure'
            : 'other',
    elapsedMs,
    estimatedTotalMs,
    previousRuns: previous.map((run) => run.id),
    more: active(current.status),
  };
};

const get = async <T>(options: JenkinsOptions, env: Env, path: string): Promise<T> => {
  const auth = jenkinsAuth(options, env);
  if (!auth) throw new JenkinsError(`set ${options.userEnv} and ${options.tokenEnv}`, 401);
  const response = await fetch(`${options.url}${path}`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new JenkinsError(`Jenkins ${response.status} reading stage timings`, response.status);
  return (await response.json()) as T;
};
// Finished comparison builds never change while following the same run. Avoid downloading them every poll.
const historyCache = new Map<string, { at: number; runs: WorkflowRun[] }>();
export const readJenkinsTimings = async (
  options: JenkinsOptions,
  env: Env,
  job: string,
  runId: string,
): Promise<RunTimings> => {
  const path = jobPath(job);
  try {
    const current = await get<WorkflowRun>(
      options,
      env,
      `${path}/${encodeURIComponent(runId)}/wfapi/describe`,
    );
    const key = `${options.url}/${job}/${runId}`;
    let history = historyCache.get(key);
    if (!history || Date.now() - history.at > 60_000) {
      history = {
        at: Date.now(),
        runs: await get<WorkflowRun[]>(options, env, `${path}/wfapi/runs`),
      };
      historyCache.set(key, history);
      if (historyCache.size > 30) historyCache.delete(historyCache.keys().next().value!);
    }
    return compareTimings(current, history.runs);
  } catch (error) {
    if (error instanceof JenkinsError && error.status === 404)
      return {
        stages: [],
        previousRuns: [],
        more: false,
        unavailable: 'Stage timings are unavailable for this job (Pipeline REST API required).',
      };
    throw error;
  }
};
