import { otherActiveRuns, readOtherActiveRuns } from './activeRuns';
import { readJenkinsTimings } from './timings';
import {
  definePlugin,
  type Env,
  fillTemplate,
  type LatestRun,
  type PlanFix,
  type StepActor,
  type StepInput,
  type StepRun,
  type StepStatus,
  type TriggerPlan,
} from '../../core/plugin';
import {
  buildParam,
  buildRevision,
  BUILDS_READ,
  type JenkinsBuild,
  type JenkinsJob,
  JenkinsError,
  type JenkinsOptions,
  jenkinsAuth,
  jenkinsGet,
  JOB_TREE,
  jenkinsConfigXml,
  jenkinsLog,
  saveJenkinsConfigXml,
  jobPath,
  buildCause,
} from './api';
import { logVersion } from './logVersion';
import { addChoice, checkParams, jenkinsErrorText, jobParameters } from './params';

export type { JenkinsOptions };

/** A param value in config: fixed, or worked out from the branch / env / what came before. */
export type ParamValue =
  | string
  | boolean
  | number
  | ((input: StepInput) => string | boolean | number | undefined);

/** A `job` step's options in the pipeline. */
export interface JobStepOptions {
  /** The job's name (folders as `a/b`); `{env}` and `{branch}` are filled in. */
  job: string;
  /** The parameter holding the branch: builds are matched by it, and a trigger sets it. */
  branchParam?: string;
  /**
   * Compare by commit: the build's checked-out SHA from the remote whose URL contains this,
   * against the `sha` of the step before it.
   */
  revisionRepo?: string;
  /**
   * Compare by artifact: param → step id. The param's value ends in that step's build number
   * (`1.0.x-release-26-13.1008` ← build #1008); a trigger sets it to that step's `version`.
   */
  versions?: Record<string, string>;
  /**
   * What this build produced, read from its own console: the first match (its first capture
   * group) in the last good build's log — e.g. /fe-nginx:(\S+)/ for the image tag it pushed.
   * Preferred over `version`, which is only the fallback when the log has no match.
   */
  versionFromLog?: RegExp;
  /** What this build produces, worked out by a rule — e.g. an image tag from the build number. */
  version?: (input: StepInput & { buildNumber: number }) => string | undefined;
  /** Every other parameter a trigger sends — all of them explicitly, defaults are not trusted. */
  params?: Record<string, ParamValue>;
}

/** Who started the build: a user by id and name, else what did (a timer, an upstream job). */
const actorOf = (build: JenkinsBuild): StepActor | undefined => {
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

const runOf = (build: JenkinsBuild): StepRun => ({
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

/** The job, or undefined when it does not exist on this server. */
const readJob = async (options: JenkinsOptions, env: Env, job: string) => {
  try {
    return await jenkinsGet<JenkinsJob>(options, env, jobPath(job), JOB_TREE);
  } catch (error) {
    if (error instanceof JenkinsError && error.status === 404) return undefined;
    throw error;
  }
};

/** What the job last did on its env, whichever branch it was for. */
const jobLatest = async (
  options: JenkinsOptions,
  env: Env,
  input: StepInput,
): Promise<LatestRun> => {
  const step = jobOptions(input);
  const job = fillTemplate(step.job, input);
  const data = await readJob(options, env, job);
  if (!data) return { state: 'missing', summary: `no job ${job}` };
  const newest = data.builds[0];
  const ok = data.builds.find((build) => build.result === 'SUCCESS');
  if (!newest) return { state: 'none', summary: 'never ran', url: data.url };
  const shown = ok ?? newest;
  const versions = Object.fromEntries(
    Object.keys(step.versions ?? {})
      .map((param) => [param, buildParam(shown, param)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return {
    state: newest.building || data.inQueue ? 'running' : ok === newest ? 'done' : 'failed',
    branch: step.branchParam ? buildParam(shown, step.branchParam) : undefined,
    summary: `#${shown.number}${newest !== shown ? ` (#${newest.number} ${newest.result?.toLowerCase() ?? 'running'})` : ''}`,
    ref: { buildNumber: shown.number, finishedAt: shown.timestamp + shown.duration },
    versions,
    at: shown.timestamp + shown.duration,
    url: shown.url,
  };
};

const trailingNumber = (value: string | undefined) => {
  const match = value?.match(/\.(\d+)$/);
  return match ? Number(match[1]) : undefined;
};

const jobOptions = (input: StepInput) => input.step as unknown as JobStepOptions;

/**
 * Where a job stands for the branch (and env) relative to the steps before it — by commit, by
 * artifact build number, else by time.
 */
const jobStatus = async (
  options: JenkinsOptions,
  env: Env,
  input: StepInput,
): Promise<StepStatus> => {
  const step = jobOptions(input);
  const job = fillTemplate(step.job, input);
  const data = await readJob(options, env, job);
  if (!data) return { state: 'missing', summary: `no job ${job} on ${options.url}` };
  const builds = step.branchParam
    ? data.builds.filter((build) => buildParam(build, step.branchParam as string) === input.branch)
    : data.builds;
  const runs = builds.slice(0, 6).map((build) => ({
    ...runOf(build),
    branch: step.branchParam ? buildParam(build, step.branchParam) : undefined,
  }));
  const latest = builds[0];
  const ok = builds.find((build) => build.result === 'SUCCESS');
  const base = {
    url: data.url,
    runs,
    activeRuns: otherActiveRuns(data.builds, step.branchParam, input.branch),
  };
  if (!latest) {
    //? Jenkins keeps a limited history per job — say how much was looked through, and show the
    //? job's own recent runs (labelled with their branch) instead of an empty list
    const newest = data.builds[0];
    const other = newest && step.branchParam ? buildParam(newest, step.branchParam) : undefined;
    return {
      ...base,
      runs: data.builds.slice(0, 6).map((build) => ({
        ...runOf(build),
        branch: step.branchParam ? buildParam(build, step.branchParam) : undefined,
        detail: step.branchParam ? buildParam(build, step.branchParam) : undefined,
      })),
      state: data.inQueue ? 'running' : 'none',
      summary: step.branchParam ? `never run for ${input.branch}` : `${job} never ran`,
      notes: step.branchParam
        ? [
            data.builds.length >= BUILDS_READ
              ? `none of the last ${BUILDS_READ} runs of ${job} is for ${input.branch}`
              : `none of the ${data.builds.length} runs Jenkins keeps for ${job} is for ${input.branch}`,
            ...(newest ? [`newest is #${newest.number}, for ${other ?? '?'}`] : []),
          ]
        : [],
    };
  }

  //? The version: what the build's own log says it pushed, else the config's rule
  const logged =
    ok && step.versionFromLog
      ? await logVersion(options, env, job, ok.number, step.versionFromLog).catch(() => undefined)
      : undefined;
  const derived = ok && !logged ? step.version?.({ ...input, buildNumber: ok.number }) : undefined;
  const ref = ok && {
    buildNumber: ok.number,
    finishedAt: ok.timestamp + ok.duration,
    sha: step.revisionRepo ? buildRevision(ok, step.revisionRepo) : undefined,
    version: logged ?? derived,
    versionSource: logged ? ('log' as const) : derived ? ('derived' as const) : undefined,
  };
  const notes: string[] = [];
  let stale = false;
  //? A deploy job is per env, not per branch: say when the env now runs someone else's branch
  const newest = data.builds[0];
  if (step.branchParam && step.job.includes('{env}') && newest && newest !== latest) {
    notes.push(
      `latest run #${newest.number} was for ${buildParam(newest, step.branchParam) ?? '?'}`,
    );
  }

  if (ref) {
    for (const [stepId, upstream] of Object.entries(input.upstream)) {
      const theirs = upstream.ref;
      if (!theirs) continue;
      if (step.revisionRepo && theirs.sha) {
        if (ref.sha !== theirs.sha) {
          stale = true;
          notes.push(
            `built ${ref.sha?.slice(0, 8) ?? '?'}, ${stepId} is at ${theirs.sha.slice(0, 8)}`,
          );
        }
        continue;
      }
      const param = Object.entries(step.versions ?? {}).find(([, id]) => id === stepId)?.[0];
      if (param && theirs.buildNumber !== undefined) {
        const deployed = buildParam(ok, param);
        if (trailingNumber(deployed) !== theirs.buildNumber) {
          stale = true;
          notes.push(`${param} is ${deployed ?? '?'}, ${stepId} has #${theirs.buildNumber}`);
        } else notes.push(`${param} ${deployed} = ${stepId} #${theirs.buildNumber}`);
        continue;
      }
      if (theirs.finishedAt && ref.finishedAt < theirs.finishedAt) {
        stale = true;
        notes.push(`last run finished before ${stepId}`);
      }
    }
    //? Versions whose step had nothing to compare against are still worth seeing
    for (const param of Object.keys(step.versions ?? {})) {
      const value = buildParam(ok, param);
      if (value && !notes.some((note) => note.startsWith(param))) notes.push(`${param} = ${value}`);
    }
  }

  const failedSince = !latest.building && latest !== ok && latest.result !== 'ABORTED';
  const state: StepStatus['state'] =
    latest.building || data.inQueue
      ? 'running'
      : !ok
        ? //? Never good for this branch: an aborted attempt is "not done yet", not a failure
          latest.result === 'ABORTED' || builds.every((build) => build.result === 'ABORTED')
          ? 'none'
          : 'failed'
        : stale
          ? 'stale'
          : failedSince
            ? 'failed'
            : 'done';
  const when = ok
    ? new Date(ok.timestamp + ok.duration).toISOString().slice(0, 16).replace('T', ' ')
    : '';
  return {
    ...base,
    state,
    summary: ok
      ? `#${ok.number} ok ${when}${ref?.sha ? ` · ${ref.sha.slice(0, 8)}` : ''}${failedSince ? ` · #${latest.number} ${latest.result?.toLowerCase()}` : ''}`
      : `#${latest.number} ${latest.result?.toLowerCase() ?? 'running'}`,
    ref: ref || undefined,
    actor: actorOf(latest),
    outputs:
      ref && ref.version
        ? [
            {
              label: 'version',
              value: ref.version,
              note: ref.versionSource === 'log' ? 'from its log' : 'derived from the build number',
            },
          ]
        : undefined,
    notes,
  };
};

const resolveParam = (value: ParamValue, input: StepInput) =>
  typeof value === 'function' ? value(input) : value;

/** buildWithParameters with every parameter spelled out. Nothing is sent from here. */
const jobPlan = async (
  options: JenkinsOptions,
  env: Env,
  input: StepInput,
): Promise<TriggerPlan> => {
  const step = jobOptions(input);
  const job = fillTemplate(step.job, input);
  const params: Record<string, string> = {};
  const sources: Record<string, string> = {};
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(step.params ?? {})) {
    const resolved = resolveParam(value, input);
    if (resolved === undefined) warnings.push(`${name} has no value`);
    else params[name] = String(resolved);
  }
  if (step.branchParam) {
    params[step.branchParam] = input.branch;
    sources[step.branchParam] = 'branch';
  }
  for (const [param, stepId] of Object.entries(step.versions ?? {})) {
    const version = input.upstream[stepId]?.ref?.version;
    if (version) {
      params[param] = version;
      sources[param] = stepId;
    } else warnings.push(`${param}: ${stepId} has no successful build to deploy`);
  }
  //? Only a version worked out by a rule needs checking; one read from the build's log is what it pushed
  for (const [param, stepId] of Object.entries(step.versions ?? {})) {
    const ref = input.upstream[stepId]?.ref;
    if (ref?.version && ref.versionSource !== 'log')
      warnings.push(`${param} is derived from build #${ref.buildNumber} — check it`);
  }
  //? Checked against the job as Jenkins defines it now (a read): a value its choice list refuses
  //? would come back as a 500 with nothing started
  const fixes: PlanFix[] = [];
  const blockers: string[] = [];
  try {
    const checked = checkParams(params, await jobParameters(options, env, job), job);
    blockers.push(...checked.blockers);
    warnings.push(...checked.warnings);
    fixes.push(...checked.fixes);
  } catch (error) {
    warnings.push(`could not read ${job}'s parameters to check them: ${(error as Error).message}`);
  }
  return {
    target: job,
    method: 'POST',
    url: `${options.url}${jobPath(job)}/buildWithParameters`,
    params,
    sources,
    warnings,
    blockers,
    fixes,
    shellAuth: `-u "\$${options.userEnv}:\$${options.tokenEnv}"`,
  };
};

export const jenkinsPlugin = definePlugin<JenkinsOptions>({
  id: 'jenkins',
  label: 'Jenkins',
  icon: '🤵',
  transports: [
    {
      id: 'api',
      label: 'API (user + API token)',
      capabilities: ['jobs', 'trigger'],
      probe: async ({ options, env }) => {
        if (!options.url) return { ok: false, detail: 'no url configured' };
        try {
          //? Reachability first, without credentials: a VPN-only server times out or fails DNS
          const login = await fetch(`${options.url}/login`, { signal: AbortSignal.timeout(6_000) });
          if (!login.ok) return { ok: false, detail: `${options.url} answered ${login.status}` };
        } catch (error) {
          return { ok: false, detail: `unreachable (VPN?) — ${(error as Error).message}` };
        }
        if (!jenkinsAuth(options, env))
          return { ok: false, detail: `reachable; set ${options.userEnv} and ${options.tokenEnv}` };
        try {
          const me = await jenkinsGet<{ id: string; fullName: string }>(options, env, '/me');
          return {
            ok: true,
            detail: `signed in to ${options.url}`,
            identity: me.fullName || me.id,
          };
        } catch (error) {
          return { ok: false, detail: `reachable; ${(error as Error).message}` };
        }
      },
    },
    {
      id: 'ssh',
      label: 'SSH CLI',
      capabilities: ['jobs'],
      //? Jenkins announces its SSH endpoint in a header when the SSH server plugin is on.
      //? A slot for later: reported, never used for now
      probe: async ({ options }) => {
        try {
          const response = await fetch(`${options.url}/login`, {
            signal: AbortSignal.timeout(6_000),
          });
          const endpoint = response.headers.get('x-ssh-endpoint');
          return {
            ok: false,
            detail: endpoint
              ? `endpoint ${endpoint} — not supported yet`
              : 'server has no SSH endpoint',
          };
        } catch (error) {
          return { ok: false, detail: (error as Error).message };
        }
      },
    },
  ],
  steps: {
    job: {
      status: ({ options, env }, input) => jobStatus(options, env, input),
      plan: async ({ options, env }, input) => jobPlan(options, env, input),
      latest: ({ options, env }, input) => jobLatest(options, env, input),
      activeRuns: ({ options, env }, input) => {
        const step = jobOptions(input);
        return readOtherActiveRuns(
          options,
          env,
          fillTemplate(step.job, input),
          step.branchParam,
          input.branch,
        );
      },
      timings: ({ options, env }, input, run) =>
        readJenkinsTimings(options, env, fillTemplate(jobOptions(input).job, input), run.id),
      logs: async ({ options, env }, input, run, start) => {
        const job = fillTemplate(jobOptions(input).job, input);
        return jenkinsLog(options, env, `${jobPath(job)}/${encodeURIComponent(run.id)}`, start);
      },
      fix: async ({ options, env }, plan, fixId) => {
        //? add-choice:<param> — the plan's value for it goes into the job's choice list
        const param = fixId.startsWith('add-choice:') ? fixId.slice(11) : undefined;
        const value = param ? plan.params[param] : undefined;
        if (!param || value === undefined) throw new Error(`unknown fix ${fixId}`);
        //? Read fresh, right before writing: someone may have changed the job since the plan
        const xml = await jenkinsConfigXml(options, env, plan.target);
        const next = addChoice(xml, param, value);
        if (next === undefined) throw new Error(`${plan.target} has no choice parameter ${param}`);
        if (next === xml) return `${value} is already one of ${plan.target}'s ${param} choices`;
        await saveJenkinsConfigXml(options, env, plan.target, next);
        const after = await jobParameters(options, env, plan.target);
        if (!after.find((item) => item.name === param)?.choices?.includes(value))
          throw new Error(`${plan.target} was saved, but ${param} still lacks ${value}`);
        return `added ${value} to ${plan.target}'s ${param}`;
      },
      send: async ({ options, env }, plan) => {
        const auth = jenkinsAuth(options, env);
        if (!auth) throw new Error('no Jenkins credentials');
        const response = await fetch(plan.url, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(plan.params),
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) {
          //? Jenkins says why in its error page — show that, not just the status
          const reason = jenkinsErrorText(await response.text().catch(() => ''));
          throw new Error(
            `Jenkins ${response.status} on ${plan.target}${reason ? `: ${reason}` : ''}`,
          );
        }
        return { url: response.headers.get('location') ?? undefined };
      },
    },
  },
});

export default jenkinsPlugin;
