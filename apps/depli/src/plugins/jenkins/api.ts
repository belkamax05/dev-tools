import type { Env } from '../../core/plugin';

export interface JenkinsOptions {
  /** e.g. https://jenkins.example.com */
  url?: string;
  /** Variables holding the user and the API token — basic auth, as Jenkins wants it. */
  userEnv?: string;
  tokenEnv?: string;
  transports?: string[];
}

export class JenkinsError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const jenkinsAuth = (options: JenkinsOptions, env: Env) => {
  const user = options.userEnv ? env[options.userEnv] : undefined;
  const token = options.tokenEnv ? env[options.tokenEnv] : undefined;
  return user && token ? `Basic ${btoa(`${user}:${token}`)}` : undefined;
};

/** `/job/a/job/b` from `a/b` — folders are path segments. */
export const jobPath = (job: string) =>
  job
    .split('/')
    .filter(Boolean)
    .map((part) => `/job/${encodeURIComponent(part)}`)
    .join('');

/** A read: GET `<path>/api/json?tree=…`. */
export const jenkinsGet = async <T>(
  options: JenkinsOptions,
  env: Env,
  path: string,
  tree?: string,
): Promise<T> => {
  const auth = jenkinsAuth(options, env);
  if (!auth) throw new JenkinsError(`set ${options.userEnv} and ${options.tokenEnv}`, 401);
  const query = tree ? `?tree=${encodeURIComponent(tree)}` : '';
  const response = await fetch(`${options.url}${path}/api/json${query}`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new JenkinsError(`Jenkins ${response.status} on ${path}`, response.status);
  return (await response.json()) as T;
};

export interface JenkinsBuild {
  number: number;
  result: string | null;
  building: boolean;
  timestamp: number;
  duration: number;
  url: string;
  actions: Array<{
    parameters?: Array<{ name: string; value: unknown }>;
    lastBuiltRevision?: { SHA1: string };
    remoteUrls?: string[];
    causes?: Array<{ userId?: string; userName?: string; shortDescription?: string }>;
  } | null>;
}

export interface JenkinsJob {
  url: string;
  inQueue: boolean;
  builds: JenkinsBuild[];
}

/** Builds read per job — Jenkins may keep fewer, and then all of them are read. */
export const BUILDS_READ = 40;

export const JOB_TREE = `url,inQueue,builds[number,result,building,timestamp,duration,url,actions[parameters[name,value],lastBuiltRevision[SHA1],remoteUrls,causes[userId,userName,shortDescription]]]{0,${BUILDS_READ}}`;

export const buildParam = (build: JenkinsBuild, name: string): string | undefined => {
  for (const action of build.actions) {
    const found = action?.parameters?.find((param) => param.name === name);
    if (found) return String(found.value);
  }
  return undefined;
};

/** Who (or what) started a build — a user, a timer, an upstream job. */
export const buildCause = (build: JenkinsBuild) => {
  for (const action of build.actions)
    for (const cause of action?.causes ?? [])
      if (cause.userId || cause.shortDescription) return cause;
  return undefined;
};

/** A build's console from byte `start`: Jenkins' progressive text, with how far it got. */
export const jenkinsLog = async (
  options: JenkinsOptions,
  env: Env,
  path: string,
  start: number,
) => {
  const auth = jenkinsAuth(options, env);
  if (!auth) throw new JenkinsError(`set ${options.userEnv} and ${options.tokenEnv}`, 401);
  const response = await fetch(`${options.url}${path}/logText/progressiveText?start=${start}`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new JenkinsError(`Jenkins ${response.status} on ${path} log`, response.status);
  const text = await response.text();
  return {
    text,
    next:
      Number(response.headers.get('x-text-size')) || start + new TextEncoder().encode(text).length,
    more: response.headers.get('x-more-data') === 'true',
  };
};

/** The SHA a build checked out from the remote whose URL contains `repo`. */
export const buildRevision = (build: JenkinsBuild, repo: string): string | undefined =>
  build.actions.find((action) => action?.remoteUrls?.some((url) => url.includes(repo)))
    ?.lastBuiltRevision?.SHA1;

/** A job's config.xml — a read. */
export const jenkinsConfigXml = async (options: JenkinsOptions, env: Env, job: string) => {
  const auth = jenkinsAuth(options, env);
  if (!auth) throw new JenkinsError(`set ${options.userEnv} and ${options.tokenEnv}`, 401);
  const response = await fetch(`${options.url}${jobPath(job)}/config.xml`, {
    headers: { authorization: auth },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new JenkinsError(`Jenkins ${response.status} reading ${job} config`, response.status);
  return response.text();
};

/** Replace a job's config.xml — a write; only ever reached through the core's fix gate. */
export const saveJenkinsConfigXml = async (
  options: JenkinsOptions,
  env: Env,
  job: string,
  xml: string,
) => {
  const auth = jenkinsAuth(options, env);
  if (!auth) throw new JenkinsError(`set ${options.userEnv} and ${options.tokenEnv}`, 401);
  const response = await fetch(`${options.url}${jobPath(job)}/config.xml`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/xml' },
    body: xml,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new JenkinsError(`Jenkins ${response.status} saving ${job} config`, response.status);
};
