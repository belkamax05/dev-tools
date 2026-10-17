import { afterAll, expect, spyOn, test } from 'bun:test';

import type { PluginContext, StepInput } from '../../core/plugin';
import type { JenkinsBuild, JenkinsOptions } from './api';
import { jenkinsPlugin } from '.';

const HOUR = 3_600_000;
const build = (
  number: number,
  hoursAgo: number,
  branch: string,
  node: string,
  result = 'SUCCESS',
): JenkinsBuild => ({
  number,
  result,
  building: false,
  timestamp: Date.now() - hoursAgo * HOUR,
  duration: 60_000,
  url: `https://ci/job/x/${number}/`,
  actions: [
    {
      parameters: [
        { name: 'FE_CODE_BRANCH', value: branch },
        { name: 'FE_NODE_VERSION', value: `1.0.x-${branch}.${node}` },
      ],
    },
  ],
});

//? The frontend-only job last deployed 26.13 two days ago; a full env deploy put 26.14 on later
const JOBS: Record<string, JenkinsBuild[]> = {
  deploy_frontend_only_perf: [build(32, 48, 'release-sprint-26.13', '3258')],
  deploy_environment_perf: [
    build(267, 1, 'release-sprint-26.14', '3280', 'FAILURE'),
    build(266, 24, 'release-sprint-26.14', '3273'),
  ],
};

const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (url: string) => {
  const job = Object.keys(JOBS).find((name) => url.includes(`/job/${name}/`));
  if (!job) return new Response('', { status: 404 });
  return Response.json({ url: `https://ci/job/${job}/`, inQueue: false, builds: JOBS[job] });
}) as unknown as typeof fetch);
//? Every test file shares the process: put the real fetch back
afterAll(() => fetchSpy.mockRestore());

const context = {
  cwd: '/tmp',
  env: { USER_ENV: 'u', TOKEN_ENV: 't' },
  options: { url: 'https://ci', userEnv: 'USER_ENV', tokenEnv: 'TOKEN_ENV' },
} as unknown as PluginContext<JenkinsOptions>;
const input = (alsoDeployedBy?: string[], branch = ''): StepInput => ({
  step: {
    id: 'deploy',
    label: 'Deploy',
    provider: 'jenkins',
    kind: 'job',
    job: 'deploy_frontend_only_{env}',
    branchParam: 'FE_CODE_BRANCH',
    versions: { FE_NODE_VERSION: 'build-nodejs' },
    ...(alsoDeployedBy ? { alsoDeployedBy } : {}),
  },
  branch,
  env: 'perf',
  upstream: {},
});
const job = jenkinsPlugin.steps.job!;

test('what an env runs counts a newer successful full environment deploy', async () => {
  const latest = await job.latest!(context, input(['deploy_environment_{env}']));
  expect(latest).toMatchObject({
    state: 'done',
    branch: 'release-sprint-26.14',
    summary: 'deploy_environment_perf #266',
    versions: { FE_NODE_VERSION: '1.0.x-release-sprint-26.14.3273' },
  });
});

test('without alsoDeployedBy only the step’s own job is read', async () => {
  const latest = await job.latest!(context, input());
  expect(latest).toMatchObject({ branch: 'release-sprint-26.13', summary: '#32' });
});

test('the chain credits the branch deployed by the other job, saying so', async () => {
  const status = await job.status(
    context,
    input(['deploy_environment_{env}'], 'release-sprint-26.14'),
  );
  expect(status.state).toBe('done');
  expect(status.ref?.buildNumber).toBe(266);
  expect(status.summary.startsWith('deploy_environment_perf #266 ok')).toBe(true);
  expect(status.notes).toContain(
    "deployed by deploy_environment_perf #266 — newer than deploy_frontend_only_perf's own runs",
  );
});
