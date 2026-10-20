import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import Box from '@/dev-tools/ui/components/Box';

import type { History } from '../../../core/history';
import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';
import { resolveProject } from '../../../core/registry';
import type { DepliData } from '../../useDepli';
import EnvironmentsView from '../EnvironmentsView';
import EnvironmentsDetail from '.';

const pipeline: StepConfig[] = [
  { id: 'push', label: 'Push', provider: 'github', kind: 'branch' },
  { id: 'build', label: 'Build', provider: 'jenkins', kind: 'job', job: 'build', after: ['push'] },
  {
    id: 'deploy',
    label: 'Deploy to {env}',
    provider: 'jenkins',
    kind: 'job',
    job: 'deploy_{env}',
    versions: { VERSION: 'build' },
    after: ['build'],
  },
];

const project = resolveProject('/tmp/app', {
  providers: {
    github: { plugin: 'github', repo: 'o/app' },
    jenkins: { plugin: 'jenkins', url: 'https://ci.test' },
  },
  envs: [
    { id: 'qa', url: 'https://qa.test', branches: ['develop'] },
    { id: 'staging', protected: true, branches: ['release-*'] },
  ],
  pipeline,
});

const at = new Date(2026, 9, 19, 14, 2).getTime();
const rows: EnvRow[] = ['qa', 'staging'].map((env) => ({
  env,
  protected: env === 'staging',
  cells: [
    {
      step: pipeline[2] as StepConfig,
      latest: {
        state: 'done',
        summary: '#7',
        branch: 'develop',
        versions: { VERSION: '1.0.42' },
        at,
        url: `https://ci.test/job/deploy_${env}/7/`,
      },
    },
  ],
}));

const history: History = {
  shared: [
    {
      step: pipeline[1] as StepConfig,
      jobs: [
        {
          job: 'build',
          url: 'https://ci.test/job/build/',
          runs: [
            { id: '42', label: '#42', state: 'success', at, url: 'https://ci.test/job/build/42/' },
          ],
        },
      ],
    },
  ],
  envs: ['qa', 'staging'].map((env) => ({
    env,
    steps: [
      {
        step: pipeline[2] as StepConfig,
        jobs: [
          {
            job: `deploy_${env}`,
            url: `https://ci.test/job/deploy_${env}/`,
            runs: [
              {
                id: '7',
                label: '#7',
                state: 'success',
                at,
                durationMs: 61_000,
                branch: 'develop',
                url: `https://ci.test/job/deploy_${env}/7/`,
                params: { VERSION: '1.0.42' },
                actor: { login: 'mb' },
              },
            ],
          },
        ],
      },
    ],
  })),
  branches: {},
  readAt: at,
};

const data = {
  branch: 'develop',
  targetEnv: 'qa',
  connections: {},
  chain: [],
  envs: rows,
  history,
  historyLoading: false,
  loadEnvs: () => {},
  loadHistory: () => {},
  setEnv: () => {},
} as unknown as DepliData;

const draw = (node: React.ReactNode) =>
  Bun.stripANSI(
    renderToString(
      <Box height={60} width={140} flexDirection="column">
        {node}
      </Box>,
      { columns: 140 },
    ),
  );

test('the Environments window extends the picker table and draws the env at the cursor', () => {
  const out = draw(
    <EnvironmentsView data={data} project={project} notify={() => {}} onClose={() => {}} />,
  );
  expect(out).toContain('TRACKS');
  //? staging tracks release-*, runs develop
  expect(out).toContain('off-track');
  expect(out).toContain('Deploy to qa');
  expect(out).toContain('▸ deploy_qa ↗  1 run · 1 ✓');
  expect(out).toContain('on qa: ✓ develop');
  expect(out).toContain('on qa: #42 ✓');
});

test('the detailed view shows every env, the relations and the shared builds', () => {
  const out = draw(
    <EnvironmentsDetail data={data} project={project} notify={() => {}} onClose={() => {}} />,
  );
  expect(out).toContain('Environments — detailed');
  expect(out).toContain('Branches → envs');
  expect(out).toContain('develop   ─┬─▶ qa');
});
