import type { Env, StepRun } from '../../core/plugin';
import { buildParam, type JenkinsBuild, type JenkinsOptions, jenkinsGet, jobPath } from './api';

/** Running builds belong to the job, not necessarily the branch currently shown in the app. */
export const otherActiveRuns = (
  builds: JenkinsBuild[],
  branchParam: string | undefined,
  branch: string,
  now = Date.now(),
): StepRun[] => {
  if (!branchParam) return [];
  return builds
    .filter((build) => build.building && buildParam(build, branchParam) !== branch)
    .map((build) => ({
      id: String(build.number),
      label: `#${build.number}`,
      branch: buildParam(build, branchParam) ?? 'unknown branch',
      state: 'running',
      at: build.timestamp,
      durationMs: Math.max(0, now - build.timestamp),
      url: build.url,
    }));
};
export const readOtherActiveRuns = async (
  options: JenkinsOptions,
  env: Env,
  job: string,
  branchParam: string | undefined,
  branch: string,
) => {
  if (!branchParam) return [];
  const data = await jenkinsGet<{ builds: JenkinsBuild[] }>(
    options,
    env,
    jobPath(job),
    'builds[number,building,timestamp,url,actions[parameters[name,value]]]{0,40}',
  );
  return otherActiveRuns(data.builds, branchParam, branch);
};
