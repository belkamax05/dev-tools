import {
  type Env,
  fillTemplate,
  type HistoryRun,
  type JobHistory,
  type StepActor,
  type StepInput,
  type StepRun,
} from '../../core/plugin';
import {
  buildCause,
  buildParam,
  buildRevision,
  type JenkinsBuild,
  JenkinsError,
  type JenkinsJob,
  type JenkinsOptions,
  jenkinsGet,
  jobPath,
} from './api';
import type { JobStepOptions } from './index';

/** Builds read per job for the detailed view — more than a status needs, still one request. */
export const HISTORY_READ = 100;

const HISTORY_TREE = `url,builds[number,result,building,timestamp,duration,url,actions[parameters[name,value],causes[userId,userName,shortDescription],lastBuiltRevision[SHA1],remoteUrls]]{0,${HISTORY_READ}}`;

/** Who started the build: a user by id and name, else what did (a timer, an upstream job). */
export const actorOf = (build: JenkinsBuild): StepActor | undefined => {
  const cause = buildCause(build);
  if (!cause) return undefined;
  return {
    //? A user by id and name; anything else (a timer, an upstream job) by what Jenkins calls it
    login: cause.userId ?? cause.shortDescription?.replace(/^Started by /i, '') ?? 'jenkins',
    name: cause.userId ? cause.userName : undefined,
    action: 'started',
    at: build.timestamp,
  };
};

export const runOf = (build: JenkinsBuild): StepRun => ({
  id: String(build.number),
  label: `#${build.number}`,
  state: build.building
    ? 'running'
    : build.result === 'SUCCESS'
      ? 'success'
      : build.result === 'ABORTED'
        ? 'aborted'
        : build.result === 'FAILURE' || build.result === 'UNSTABLE'
          ? 'failure'
          : 'other',
  at: build.timestamp,
  durationMs: build.building ? Date.now() - build.timestamp : build.duration,
  url: build.url,
});

/** Every parameter a build was given, as text. */
const paramsOf = (build: JenkinsBuild): Record<string, string> =>
  Object.fromEntries(
    build.actions.flatMap((action) =>
      (action?.parameters ?? []).map((param) => [param.name, String(param.value)] as const),
    ),
  );

/** One job's builds as history runs — the branch read from `branchParam` when the step has one. */
export const historyOf = (
  job: string,
  data: Pick<JenkinsJob, 'url' | 'builds'>,
  branchParam?: string,
  relation?: string,
  revisionRepo?: string,
): JobHistory => ({
  job,
  url: data.url,
  relation,
  runs: data.builds.map(
    (build): HistoryRun => ({
      ...runOf(build),
      branch: branchParam ? buildParam(build, branchParam) : undefined,
      params: paramsOf(build),
      actor: actorOf(build),
      sha: revisionRepo
        ? buildRevision(build, revisionRepo)
        : build.actions.find((action) => action?.lastBuiltRevision)?.lastBuiltRevision?.SHA1,
    }),
  ),
});

/**
 * The step's own job and every `alsoDeployedBy` job, each with its last `HISTORY_READ` builds. A
 * job missing on the server is listed as missing rather than failing the rest.
 */
export const readJobHistory = async (
  options: JenkinsOptions,
  env: Env,
  input: StepInput,
): Promise<JobHistory[]> => {
  const step = input.step as unknown as Pick<
    JobStepOptions,
    'job' | 'branchParam' | 'alsoDeployedBy' | 'revisionRepo'
  >;
  const jobs = [
    { job: fillTemplate(step.job, input), relation: undefined },
    ...(step.alsoDeployedBy ?? []).map((job) => ({
      job: fillTemplate(job, input),
      relation: `also does ${input.step.id} (alsoDeployedBy)`,
    })),
  ];
  return Promise.all(
    jobs.map(async ({ job, relation }): Promise<JobHistory> => {
      try {
        const data = await jenkinsGet<JenkinsJob>(options, env, jobPath(job), HISTORY_TREE);
        return historyOf(job, data, step.branchParam, relation, step.revisionRepo);
      } catch (error) {
        if (error instanceof JenkinsError && error.status === 404)
          return { job, relation, runs: [], missing: true };
        throw error;
      }
    }),
  );
};
