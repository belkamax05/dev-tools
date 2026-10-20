import { expect, test } from 'bun:test';

import type { JenkinsBuild } from './api';
import { historyOf } from './history';

const build = (
  number: number,
  branch: string,
  result: string | null = 'SUCCESS',
): JenkinsBuild => ({
  number,
  building: result === null,
  timestamp: 1000 * number,
  duration: 2000,
  result,
  url: `https://ci/job/deploy/${number}/`,
  actions: [
    {
      parameters: [
        { name: 'FE_CODE_BRANCH', value: branch },
        { name: 'FE_NGINX_VERSION', value: `1.0.x.${number + 100}` },
        { name: 'FLAG', value: true },
      ],
    },
    { causes: [{ userId: 'mb', userName: 'Maksym' }] },
    { lastBuiltRevision: { SHA1: `sha${number}` }, remoteUrls: ['git@github.com:o/app.git'] },
    null,
  ],
});

test('turns a job into history runs: every param, the branch, who started it', () => {
  const history = historyOf(
    'deploy_ci',
    {
      url: 'https://ci/job/deploy/',
      builds: [build(2, 'develop', null), build(1, 'master', 'FAILURE')],
    },
    'FE_CODE_BRANCH',
    'also does deploy',
    'o/app',
  );
  expect(history).toMatchObject({
    job: 'deploy_ci',
    url: 'https://ci/job/deploy/',
    relation: 'also does deploy',
  });
  expect(history.runs).toHaveLength(2);
  expect(history.runs[0]).toMatchObject({
    id: '2',
    label: '#2',
    state: 'running',
    branch: 'develop',
    url: 'https://ci/job/deploy/2/',
    params: { FE_CODE_BRANCH: 'develop', FE_NGINX_VERSION: '1.0.x.102', FLAG: 'true' },
    actor: { login: 'mb', name: 'Maksym' },
    sha: 'sha2',
  });
  expect(history.runs[1]?.state).toBe('failure');
});

test('without a branch parameter, runs carry no branch', () => {
  const history = historyOf('propagate', { url: 'u', builds: [build(1, 'develop')] });
  expect(history.runs[0]?.branch).toBeUndefined();
  expect(history.relation).toBeUndefined();
});
