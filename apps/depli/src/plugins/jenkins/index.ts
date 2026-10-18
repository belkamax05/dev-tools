import { otherActiveRuns, readOtherActiveRuns } from './activeRuns';
import { readJenkinsTimings } from './timings';
import {
  definePlugin,
  type Env,
  fillTemplate,
  type LatestRun,
  type PlanFix,
  type ProbeFact,
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
import { stamp } from '../../core/time';
import { logVersion } from './logVersion';
import { probeJenkinsSsh, sshJobLatest, sshJobLog, sshJobStatus } from './ssh';
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
  /**
   * Other jobs that also do this step's work — e.g. a full environment deploy that deploys the
   * frontend too (`deploy_environment_{env}`). Their successful builds, read with the same
   * `branchParam` and `versions` params, count as this step's result when newer than its own;
   * triggers, runs and logs stay on `job`. A job missing on the server is skipped.
   */
  alsoDeployedBy?: string[];
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

/** A build of one of `alsoDeployedBy`'s jobs, with the job it belongs to. */
interface ElsewhereBuild {
  job: string;
  build: JenkinsBuild;
}

/**
 * The successful builds of the step's `alsoDeployedBy` jobs, newest first — only those for
 * `branch` when given (and the step has a `branchParam`).
 */
const deployedElsewhere = async (
  options: JenkinsOptions,
  env: Env,
  input: StepInput,
  branch?: string,
): Promise<ElsewhereBuild[]> => {
  const step = jobOptions(input);
  const jobs = (step.alsoDeployedBy ?? []).map((job) => fillTemplate(job, input));
  const read = await Promise.all(
    jobs.map(async (job) => {
      const data = await readJob(options, env, job).catch(() => undefined);
      return (data?.builds ?? [])
        .filter(
          (build) =>
            build.result === 'SUCCESS' &&
            (!branch || !step.branchParam || buildParam(build, step.branchParam) === branch),
        )
        .map((build) => ({ job, build }));
    }),
  );
  return read.flat().sort((a, b) => b.build.timestamp - a.build.timestamp);
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
  const own = data.builds.find((build) => build.result === 'SUCCESS');
  //? Another job (a full environment deploy) may have put something newer on the env
  const [other] = await deployedElsewhere(options, env, input);
  const elsewhere = other && (!own || other.build.timestamp > own.timestamp) ? other : undefined;
  const ok = elsewhere?.build ?? own;
  if (!newest && !elsewhere) return { state: 'none', summary: 'never ran', url: data.url };
  const shown = (ok ?? newest) as JenkinsBuild;
  const versions = Object.fromEntries(
    Object.keys(step.versions ?? {})
      .map((param) => [param, buildParam(shown, param)] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
  return {
    state:
      newest?.building || data.inQueue
        ? 'running'
        : ok === newest || (elsewhere && (!newest || elsewhere.build.timestamp > newest.timestamp))
          ? 'done'
          : 'failed',
    branch: step.branchParam ? buildParam(shown, step.branchParam) : undefined,
    summary: elsewhere
      ? `${elsewhere.job} #${shown.number}`
      : `#${shown.number}${newest && newest !== shown ? ` (#${newest.number} ${newest.result?.toLowerCase() ?? 'running'})` : ''}`,
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
  const own = builds.find((build) => build.result === 'SUCCESS');
  //? Done for this branch by another job (a full environment deploy) more recently than its own
  const [other] = step.alsoDeployedBy?.length
    ? await deployedElsewhere(options, env, input, input.branch)
    : [];
  const elsewhere = other && (!own || other.build.timestamp > own.timestamp) ? other : undefined;
  const ok = elsewhere?.build ?? own;
  const base = {
    url: data.url,
    runs,
    activeRuns: otherActiveRuns(data.builds, step.branchParam, input.branch),
  };
  if (!latest && !elsewhere) {
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
    ok && ok === own && step.versionFromLog
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
  if (elsewhere)
    notes.push(
      `deployed by ${elsewhere.job} #${elsewhere.build.number} — newer than ${job}'s own runs`,
    );
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

  //? A failure of its own job is not "since" when another job deployed it successfully after
  const failedSince = Boolean(
    latest &&
      !latest.building &&
      latest !== ok &&
      latest.result !== 'ABORTED' &&
      !(elsewhere && elsewhere.build.timestamp > latest.timestamp),
  );
  const state: StepStatus['state'] =
    latest?.building || data.inQueue
      ? 'running'
      : !ok
        ? //? Never good for this branch: an aborted attempt is "not done yet", not a failure
          latest?.result === 'ABORTED' || builds.every((build) => build.result === 'ABORTED')
          ? 'none'
          : 'failed'
        : stale
          ? 'stale'
          : failedSince
            ? 'failed'
            : 'done';
  const when = ok
    ? stamp(ok.timestamp + ok.duration)
    : '';
  return {
    ...base,
    state,
    summary: ok
      ? `${elsewhere ? `${elsewhere.job} ` : ''}#${ok.number} ok ${when}${ref?.sha ? ` · ${ref.sha.slice(0, 8)}` : ''}${failedSince && latest ? ` · #${latest.number} ${latest.result?.toLowerCase()}` : ''}`
      : `#${latest?.number} ${latest?.result?.toLowerCase() ?? 'running'}`,
    ref: ref || undefined,
    actor: actorOf(
      elsewhere && (!latest || elsewhere.build.timestamp > latest.timestamp)
        ? elsewhere.build
        : (latest as JenkinsBuild),
    ),
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

/** The connection is Jenkins' SSH server — the CLI, read-only — not the API. */
const overSsh = (context: { connection?: { transport?: string } }) =>
  context.connection?.transport === 'ssh';

export const jenkinsPlugin = definePlugin<JenkinsOptions>({
  id: 'jenkins',
  label: 'Jenkins',
  icon: '🤵',
  transports: [
    {
      id: 'api',
      label: 'API (user + API token)',
      capabilities: ['jobs', 'trigger'],
      recommended: true,
      setup: {
        label: 'Save your Jenkins login',
        detail:
          'Asks for your Jenkins user id and an API token, and stores them with the project’s env command (dfs env set) — where its setting says, .env.user by default — then probes again. Nothing to run in a shell.',
        steps: [
          'Make a token: open your Jenkins token page below → API Token → Add new token → Generate, and copy it (it is shown once).',
          'Press L (or the button) — give your Jenkins user id, then paste the token. An op://vault/item/field reference works as the token too.',
          'They are stored, used by this run straight away, and probed — no restart.',
        ],
        links: ({ options }) =>
          options.url ? [{ label: 'Your Jenkins API tokens', url: `${options.url}/me/security/` }] : [],
        inputs: [
          {
            id: 'user',
            label: 'Jenkins user id',
            initial: ({ options, env }) => (options.userEnv ? env[options.userEnv] : undefined),
          },
          {
            id: 'token',
            label: 'Jenkins API token (or an op:// reference)',
            secret: true,
            initial: ({ options, env }) => (options.tokenEnv ? env[options.tokenEnv] : undefined),
          },
        ],
        unavailable: async ({ options }) =>
          options.userEnv && options.tokenEnv
            ? undefined
            : 'depli.config.ts names no userEnv / tokenEnv for this Jenkins — add them first.',
        start: (context, onProgress, values) => {
          const { options, setEnv } = context;
          const user = values.user?.trim() ?? '';
          const token = values.token?.trim() ?? '';
          if (!setEnv || !options.userEnv || !options.tokenEnv || !user || !token) {
            onProgress({ state: 'failed', message: 'needs both a user id and a token' });
            return { cancel: () => {} };
          }
          onProgress({
            state: 'running',
            message: `storing ${options.userEnv} and ${options.tokenEnv}…`,
          });
          setEnv({ [options.userEnv]: user, [options.tokenEnv]: token })
            .then((said) => onProgress({ state: 'done', message: said }))
            .catch((error: Error) => onProgress({ state: 'failed', message: error.message }));
          return { cancel: () => {} };
        },
      },
      guide: {
        summary:
          'Jenkins\' JSON API with your user and an API token — reads builds and, when triggers are on, starts them. The only transport depli uses for Jenkins today.',
        steps: [
          'Be on the network Jenkins is on (VPN) — the probe checks that first.',
          'In Jenkins: your name (top right) → Security (or Configure) → API Token → Add new token; copy it, it is shown once.',
          'Press L — Save your Jenkins login — to give your user id and the token: stored with the project’s env command (dfs env set) under the names depli.config.ts gives (userEnv, tokenEnv), and used straight away.',
          'Or set them yourself (dfs env set NAME=value) and press P.',
        ],
      },
      probe: async ({ options, env }) => {
        if (!options.url) return { ok: false, detail: 'no url configured' };
        const user = options.userEnv ? env[options.userEnv] : undefined;
        const facts: ProbeFact[] = [
          { label: 'server', value: options.url },
          {
            label: 'user',
            value: user ? `$${options.userEnv} = ${user}` : `$${options.userEnv ?? 'userEnv'} not set`,
            tone: user ? undefined : 'error',
          },
          {
            label: 'token',
            value:
              options.tokenEnv && env[options.tokenEnv]
                ? `$${options.tokenEnv} (set)`
                : `$${options.tokenEnv ?? 'tokenEnv'} not set`,
            tone: options.tokenEnv && env[options.tokenEnv] ? undefined : 'error',
          },
        ];
        const tokenLinks = [{ label: 'Your Jenkins API tokens', url: `${options.url}/me/security/` }];
        //? Reachability first, without credentials: a VPN-only server times out or fails DNS
        try {
          const login = await fetch(`${options.url}/login`, { signal: AbortSignal.timeout(6_000) });
          if (!login.ok)
            return { ok: false, detail: `${options.url} answered ${login.status}`, facts };
        } catch (error) {
          return {
            ok: false,
            detail: `unreachable (VPN?) — ${(error as Error).message}`,
            facts,
            fix: {
              why: `${options.url} did not answer: it is usually only reachable on the company network.`,
              steps: ['Connect the VPN, then press P.', `Check ${options.url} opens in a browser.`],
            },
          };
        }
        facts[0] = { label: 'server', value: `${options.url} — reachable`, tone: 'ok' };
        if (!jenkinsAuth(options, env))
          return {
            ok: false,
            detail: `reachable; set ${options.userEnv} and ${options.tokenEnv}`,
            facts,
            fix: {
              why: 'Jenkins is up, but depli has no credentials to sign in with.',
              steps: [
                `Create an API token in Jenkins (link below) — your name → Security → API Token → Add new token.`,
                `Press L — Save your Jenkins login — to store your user id as ${options.userEnv} and the token as ${options.tokenEnv}; they are used straight away, no restart.`,
              ],
              links: tokenLinks,
            },
          };
        try {
          const me = await jenkinsGet<{ id: string; fullName: string }>(options, env, '/me');
          return {
            ok: true,
            detail: `signed in to ${options.url}`,
            identity: me.fullName || me.id,
            facts,
          };
        } catch (error) {
          const status = (error as { status?: number }).status;
          return {
            ok: false,
            detail: `reachable; ${(error as Error).message}`,
            facts,
            fix:
              status === 401 || status === 403
                ? {
                    why: `Jenkins refused ${user ?? 'the user'} with that token — revoked, mistyped, or the user id is not the login name.`,
                    steps: [
                      'Make a new API token and update the variable.',
                      `${options.userEnv} must be your Jenkins user id (shown on your profile page), not the e-mail.`,
                    ],
                    links: tokenLinks,
                  }
                : undefined,
          };
        }
      },
    },
    {
      id: 'ssh',
      label: 'SSH CLI',
      capabilities: ['jobs'],
      guide: {
        summary:
          'Jenkins\' own SSH server — the Jenkins CLI over SSH, signed in with a key from your profile. A limited, read-only fallback: the last build of each job, no history, parameters, timings or triggers. Off on most servers until an admin turns it on.',
        steps: [
          'An admin enables it: Manage Jenkins → Security → SSH Server → Fixed port (and exposes the port if a proxy is in front).',
          'Add your public key in your Jenkins profile: Security → SSH Public Keys; have it in your SSH agent.',
          'Test it: ssh -p <port> <you>@<host> who-am-i — then press P here.',
        ],
        links: [{ label: 'Jenkins CLI over SSH', url: 'https://www.jenkins.io/doc/book/managing/cli/#ssh' }],
      },
      probe: probeJenkinsSsh,
    },
  ],
  steps: {
    job: {
      status: (context, input) =>
        overSsh(context)
          ? sshJobStatus(context, input)
          : jobStatus(context.options, context.env, input),
      plan: async (context, input) => {
        if (overSsh(context))
          throw new Error('Triggers need the API transport — SSH (the Jenkins CLI) is read-only here');
        return jobPlan(context.options, context.env, input);
      },
      latest: (context, input) =>
        overSsh(context)
          ? sshJobLatest(context, input)
          : jobLatest(context.options, context.env, input),
      activeRuns: (context, input) => {
        if (overSsh(context)) return Promise.resolve([]);
        const { options, env } = context;
        const step = jobOptions(input);
        return readOtherActiveRuns(
          options,
          env,
          fillTemplate(step.job, input),
          step.branchParam,
          input.branch,
        );
      },
      timings: async (context, input, run) =>
        overSsh(context)
          ? { stages: [], previousRuns: [], more: false, unavailable: 'stage timings need the API transport' }
          : readJenkinsTimings(
              context.options,
              context.env,
              fillTemplate(jobOptions(input).job, input),
              run.id,
            ),
      logs: async (context, input, run, start) => {
        if (overSsh(context)) return sshJobLog(context, input, run, start);
        const { options, env } = context;
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
      stop: async ({ options, env }, _input, run) => {
        const auth = jenkinsAuth(options, env);
        if (!auth) throw new Error('no Jenkins credentials');
        if (!run.url) throw new Error(`${run.label} has no build URL to stop`);
        //? Jenkins answers a stop with a redirect to the build page: that is success, not followed
        const response = await fetch(`${run.url.replace(/\/?$/, '/')}stop`, {
          method: 'POST',
          headers: { authorization: auth },
          redirect: 'manual',
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok && (response.status < 300 || response.status >= 400)) {
          const reason = jenkinsErrorText(await response.text().catch(() => ''));
          throw new Error(
            `Jenkins ${response.status} stopping ${run.label}${reason ? `: ${reason}` : ''}`,
          );
        }
        return `asked Jenkins to stop ${run.label}`;
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
