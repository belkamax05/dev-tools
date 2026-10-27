import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import type { History } from '../../../core/history';
import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';
import { stepsFor } from '../../../core/chain';
import { resolveProject } from '../../../core/registry';
import type { DepliData } from '../../useDepli';
import EnvironmentsView from '.';
import { linksOf, toRun } from './lines';
import { envRootLines } from './pages';

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

const mount = () => {
  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 50, isTTY: true });
  let screen = '';
  stdout.on('data', (chunk) => {
    screen += String(chunk);
  });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const reads = {
    ...data,
    jobRunReads: () => ({ logs: false, timings: false }),
  } as unknown as DepliData;
  const app = render(
    <EnvironmentsView data={reads} project={project} notify={() => {}} onClose={() => {}} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
  /** Writes one key, then waits for `text` to be drawn — polled, so a busy machine is only slower. */
  const press = async (key: string, text?: string) => {
    screen = '';
    stdin.write(key);
    if (!text) return settle();
    for (let waited = 0; waited < 3000 && !Bun.stripANSI(screen).includes(text); waited += 25)
      await new Promise((resolve) => setTimeout(resolve, 25));
  };
  return { app, press, settle, screen: () => Bun.stripANSI(screen) };
};

test('one fullscreen view: the env table on top, the env at the cursor kept to what is on it', async () => {
  const view = mount();
  await view.press('', 'Deploy to qa');
  const out = view.screen();
  view.app.unmount();
  expect(out).toContain('MEANT FOR');
  //? staging tracks release-*, runs develop
  expect(out).toContain('off-track');
  expect(out).toContain('◂ qa');
  expect(out).toContain('branch develop   meant for develop');
  expect(out).toContain('Deploy to qa');
  expect(out).toContain('│ ✓ develop');
  expect(out).toContain('│ #42 ✓  ');
  //? Nothing that is not about qa: no job tallies, no list of every job
  expect(out).not.toContain('1 run');
});

test('Enter on a run number opens its page under a path; Esc goes back up it to the env', async () => {
  const view = mount();
  //? Step to the first link that is the deploy run's page, then Enter
  const lines = envRootLines(
    {
      configs: project.config.envs ?? [],
      pipeline,
      stepsFor: (id) => stepsFor(project, id),
      rows,
      history,
      branch: 'develop',
      targetEnv: 'qa',
      width: 131,
    },
    'qa',
  );
  const at = linksOf(lines).findIndex((link) => link.to === toRun('deploy', 'deploy_qa', '7'));
  expect(at).toBeGreaterThanOrEqual(0);
  await view.settle();
  for (let count = 0; count <= at; count++) await view.press('n');
  await view.press('\r', '◀ what qa runs now');
  expect(view.screen()).toContain('◂ qa › Deploy to qa › #7');
  expect(view.screen()).toContain('━━ deploy_qa #7');
  //? The env table stays: envs are selectable from any page
  expect(view.screen()).toContain('MEANT FOR');
  await view.press('\u001b', 'Mon 19 Oct 2026');
  expect(view.screen()).toContain('◂ qa › Deploy to qa');
  expect(view.screen()).toContain('◀ on qa');
  await view.press('\u001b', 'Pipeline');
  expect(view.screen()).toContain('Deploy to qa');
  view.app.unmount();
});

test('Tab to the envs and ↓ shows the next env, keeping the step open that it has too', async () => {
  const view = mount();
  await view.settle();
  //? The site, then — no commits read, so the push is not a page — the build's title
  await view.press('n');
  await view.press('n');
  await view.press('\r', '◂ qa › Build');
  expect(view.screen()).toContain('◂ qa › Build');
  await view.press('\t');
  await view.press('\u001b[B', '◂ staging');
  //? The build is shared: its page on staging stays open
  expect(view.screen()).toContain('◂ staging (protected) › Build');
  //? The build staging runs is listed, though the build reports no branch
  expect(view.screen()).toContain('develop · 1 run · 1 ✓');
  view.app.unmount();
});
