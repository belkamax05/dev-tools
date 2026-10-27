/** A small pipeline and what was read of it — for the Environments window's tests. */
import type { History } from '../../../core/history';
import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';

export const step = (id: string, extra: Partial<StepConfig> = {}) =>
  ({ id, label: id, provider: 'jenkins', kind: 'job', ...extra }) as StepConfig;

export const pipeline = [
  step('push', { provider: 'github', kind: 'branch' }),
  step('build-a', { after: ['push'], job: 'build_a' }),
  step('build-b', { after: ['push'], job: 'build_b' }),
  step('deploy', {
    label: 'Deploy to {env}',
    after: ['build-a', 'build-b'],
    job: 'deploy_{env}',
    versions: { A_VERSION: 'build-a' },
  }),
];

export const history: History = {
  shared: [
    {
      step: pipeline[1] as StepConfig,
      jobs: [
        {
          job: 'build_a',
          url: 'https://ci/job/build_a/',
          runs: [
            {
              id: '45',
              label: '#45',
              state: 'success',
              at: new Date(2026, 9, 19, 14, 2).getTime(),
              branch: 'develop',
              url: 'https://ci/job/build_a/45/',
            },
            {
              id: '44',
              label: '#44',
              state: 'failure',
              at: new Date(2026, 9, 19, 14, 2).getTime(),
              branch: 'master',
              url: 'https://ci/job/build_a/44/',
            },
            {
              id: '42',
              label: '#42',
              state: 'success',
              at: new Date(2026, 9, 19, 14, 2).getTime(),
              branch: 'develop',
              sha: '1a2b3c4d5e',
              actor: { login: 'mb' },
              url: 'https://ci/job/build_a/42/',
            },
          ],
        },
      ],
    },
  ],
  envs: [
    {
      env: 'ci',
      steps: [
        {
          step: pipeline[3] as StepConfig,
          jobs: [
            {
              job: 'deploy_ci',
              url: 'https://ci/job/deploy_ci/',
              runs: [
                {
                  id: '7',
                  label: '#7',
                  state: 'success',
                  at: new Date(2026, 9, 19, 14, 2).getTime(),
                  durationMs: 192_000,
                  branch: 'develop',
                  url: 'https://ci/job/deploy_ci/7/',
                  params: { A_VERSION: '1.0.x.42' },
                  actor: { login: 'mb' },
                },
              ],
            },
            { job: 'deploy_env_ci', relation: 'also does deploy', runs: [], missing: true },
          ],
        },
      ],
    },
  ],
  branches: {
    develop: [
      {
        step: pipeline[0] as StepConfig,
        jobs: [
          {
            job: 'develop',
            url: 'https://gh/commits/develop',
            relation: 'commits on develop',
            runs: [
              {
                id: 'c3c3c3c3c3',
                label: 'c3c3c3c3',
                state: 'success',
                at: new Date(2026, 9, 19, 14, 2).getTime(),
                branch: 'develop',
                sha: 'c3c3c3c3c3',
                detail: 'Newest',
                url: 'https://gh/commit/c3c3c3c3c3',
              },
              {
                id: 'c2c2c2c2c2',
                label: 'c2c2c2c2',
                state: 'success',
                at: new Date(2026, 9, 19, 14, 2).getTime(),
                branch: 'develop',
                sha: 'c2c2c2c2c2',
                detail: 'Middle',
                url: 'https://gh/commit/c2c2c2c2c2',
              },
              {
                id: '1a2b3c4d5e',
                label: '1a2b3c4d',
                state: 'success',
                at: new Date(2026, 9, 19, 14, 2).getTime(),
                branch: 'develop',
                sha: '1a2b3c4d5e',
                detail: 'Built',
                url: 'https://gh/commit/1a2b3c4d5e',
              },
            ],
          },
        ],
      },
    ],
  },
  readAt: 0,
};

export const rows: EnvRow[] = [
  {
    env: 'ci',
    protected: false,
    cells: [
      {
        step: pipeline[3] as StepConfig,
        latest: {
          state: 'done',
          summary: '#7',
          branch: 'develop',
          versions: { A_VERSION: '1.0.x.42' },
          url: 'https://ci/job/deploy_ci/7/',
        },
      },
    ],
  },
];

