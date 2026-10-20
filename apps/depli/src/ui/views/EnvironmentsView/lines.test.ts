import { expect, test } from 'bun:test';

import type { History } from '../../../core/history';
import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';
import {
  type DetailInput,
  type DetailTab,
  detailTabs,
  graphLines,
  lineText,
  linksOf,
  relationLines,
  runLine,
  jobFolds,
  jobLines,
  jobTabLines,
  overviewDoc,
  stepContent,
  tabId,
  tabLines,
} from './lines';

const step = (id: string, extra: Partial<StepConfig> = {}) =>
  ({ id, label: id, provider: 'jenkins', kind: 'job', ...extra }) as StepConfig;

const pipeline = [
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

const history: History = {
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

const rows: EnvRow[] = [
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

test('draws steps as boxes, parallel ones side by side, connectors fanning out and in', () => {
  const lines = graphLines(
    pipeline,
    (entry) => ({ title: entry.id, rows: [[{ text: String(entry.job ?? '-'), url: 'u' }]] }),
    40,
  ).map(lineText);
  expect(lines[0]).toStartWith('╭');
  //? Two builds on one level: two boxes on the same rows
  const both = lines.find((line) => line.includes('build-a'));
  expect(both).toContain('build-b');
  //? The bus from push fans out to both builds, and back in to deploy
  expect(lines.some((line) => line.includes('┌') && line.includes('┐'))).toBe(true);
  expect(lines.some((line) => line.includes('└') && line.includes('┘'))).toBe(true);
  expect(lines.at(-1)).toStartWith('╰');
});

const context = { env: 'ci', branch: 'develop', history, row: rows[0] };

test("a deploy's box: what it put on the env, by which run, with which builds; that run marked", () => {
  const content = stepContent(pipeline[3] as StepConfig, history.envs[0]?.steps[0], context);
  expect(content.title).toBe('Deploy to ci');
  const text = content.rows.map(lineText);
  expect(text[0]).toBe('on ci: ✓ develop');
  expect(text[1]).toStartWith('  by #7');
  expect(text[1]).toEndWith('mb');
  expect(text[2]).toBe('  builds build-a #42');
  expect(text[3]).toStartWith('deploy_ci  1 run · 1 ✓');
  expect(text[4]).toStartWith('  ✓ #7 ◀ on ci');
  expect(text[5]).toStartWith('+ deploy_env_ci  not on the server');
});

test("a build's box: the build the env runs in full, how it stands in its branch, that branch's runs", () => {
  const text = stepContent(pipeline[1] as StepConfig, history.shared[0], context).rows.map(
    lineText,
  );
  expect(text[0]).toBe('on ci: #42 ✓ develop');
  expect(text[1]).toContain('mb  1a2b3c4d');
  expect(text[2]).toStartWith('  1 newer good build of develop — newest #45');
  expect(text[3]).toStartWith('build_a  3 runs · 2 ✓ 1 ✗');
  expect(text[4]).toBe('  newest of develop:');
  //? Only develop's builds — master's #44 is not comparable — and the deployed one marked
  expect(text.slice(5)).toHaveLength(2);
  expect(text[5]).toStartWith('  ✓ #45');
  expect(text[6]).toStartWith('  ✓ #42 ◀ on ci');
});

test('a build the env runs that is older than the builds read says so', () => {
  const old = {
    ...rows[0],
    cells: [
      {
        ...rows[0]!.cells[0]!,
        latest: { ...rows[0]!.cells[0]!.latest, versions: { A_VERSION: '1.0.x.7' } },
      },
    ],
  } as EnvRow;
  const text = stepContent(pipeline[1] as StepConfig, history.shared[0], {
    ...context,
    row: old,
  }).rows.map(lineText);
  expect(text[0]).toBe('on ci: #7');
  expect(text[1]).toContain('older than the builds read');
});

test('the push box: the branch, its head, the commit deployed and how far behind it is', () => {
  const branchHistory = history.branches.develop?.[0];
  const text = stepContent(pipeline[0] as StepConfig, branchHistory, context).rows.map(lineText);
  expect(text[0]).toBe('ci runs develop');
  expect(text[1]).toStartWith('head ✓ c3c3c3c3');
  expect(text[1]).toEndWith('Newest');
  expect(text[2]).toBe('deployed 1a2b3c4d  2 commits behind head  ← build-a #42');
  expect(text[3]).toBe('newest commits:');
  expect(text.slice(4)).toHaveLength(3);
  expect(text[6]).toStartWith('  ✓ 1a2b3c4d ◀ on ci');
});

test('a job is one closed line until opened; open, its days fold too, the newest open', () => {
  const step = pipeline[3] as StepConfig;
  const job = history.envs[0]?.steps[0]?.jobs[0];
  if (!job) throw new Error('fixture');
  const closed = jobLines(step, job, { history }, 'ci', (_key, byDefault) => byDefault);
  expect(closed).toHaveLength(1);
  expect(lineText(closed[0] ?? [])).toContain('▸ deploy_ci ↗  1 run · 1 ✓  newest ✓ #7');
  expect(linksOf(closed)[0]).toMatchObject({ action: 'job:ci:deploy_ci', open: false });
  const open = jobLines(step, job, { history }, 'ci', (key, byDefault) =>
    key.startsWith('job:') ? true : byDefault,
  );
  expect(lineText(open[1] ?? [])).toBe('    ▾ Mon 19 Oct 2026  1 run · 1 ✓');
  expect(lineText(open[2] ?? [])).toContain('#7 ✓ 14:02');
  const dayClosed = jobLines(step, job, { history }, 'ci', (key) => key.startsWith('job:'));
  expect(dayClosed).toHaveLength(2);
  expect(jobFolds(closed)).toEqual({ keys: ['job:ci:deploy_ci'], anyClosed: true });
});

test('a run line links its number and the build it deployed', () => {
  const run = history.envs[0]?.steps[0]?.jobs[0]?.runs[0];
  if (!run) throw new Error('fixture');
  const line = runLine(pipeline[3] as StepConfig, run, { history, branch: 'develop' });
  expect(lineText(line)).toContain('#7 ✓ 14:02   3m12s  develop  build-a #42  mb');
  expect(linksOf([line]).map((link) => link.url)).toEqual([
    'https://ci/job/deploy_ci/7/',
    'https://ci/job/build_a/42/',
  ]);
});

test('relations say when nothing is configured or running', () => {
  expect(lineText(relationLines([{ id: 'ci' }], [])[0] ?? [])).toContain('envs[].branches');
  const lines = relationLines([{ id: 'ci', branches: ['release-*'], url: 'https://ci-www' }], rows);
  expect(lines.map(lineText)).toEqual([
    'release-* ───▶ ci  tracks — runs develop',
    'develop   ───▶ ci  runs — off-track, should run release-*',
  ]);
  expect(linksOf(lines)[0]?.url).toBe('https://ci-www');
});

test('the detailed view: overview and relations on top, envs and jobs as tabs', () => {
  const input: DetailInput = {
    configs: [{ id: 'ci', url: 'https://ci-www' }],
    pipeline,
    stepsFor: () => pipeline,
    rows,
    history,
    branch: 'develop',
    targetEnv: 'ci',
    width: 80,
  };
  const overview = overviewDoc(input).map(lineText);
  expect(overview.some((line) => line.includes('Branches → envs'))).toBe(true);
  expect(linksOf(overviewDoc(input)).map((link) => link.url)).toContain('https://ci-www');
  const tabs = detailTabs(input);
  expect(tabs.envs.map(tabId)).toEqual(['env:ci']);
  //? Only steps with jobs read: the push is per branch, build-b was not read, deploy once
  expect(tabs.jobs.map(tabId)).toEqual(['job:build-a', 'job:deploy']);

  const env = tabLines({ ...input, isOpen: () => true }, tabs.envs[0] as DetailTab).map(lineText);
  expect(env.some((line) => line.includes('▾ deploy_ci ↗  1 run'))).toBe(true);
  expect(env.some((line) => line.includes('Mon 19 Oct 2026'))).toBe(true);

  //? A build's tab opens its runs and says where each build is deployed now
  const job = tabLines(input, tabs.jobs[0] as DetailTab);
  const text = job.map(lineText);
  expect(text.some((line) => line.includes('#42  → ci'))).toBe(true);
  expect(text.some((line) => line.includes('▾ build_a'))).toBe(true);
  expect(text.some((line) => line.includes('#42') && line.includes('→ on ci'))).toBe(true);
  expect(linksOf(job).map((link) => link.url)).toContain('https://ci/job/build_a/');
});

test("an env-scoped job's tab: its latest run on every env, then each env's jobs", () => {
  const deploy = pipeline[3] as StepConfig;
  const input: DetailInput = {
    configs: [{ id: 'ci' }, { id: 'qa' }],
    pipeline,
    stepsFor: () => pipeline,
    rows,
    history: {
      ...history,
      envs: ['ci', 'qa'].map((env) => ({
        env,
        steps: [{ step: deploy, jobs: [{ job: `deploy_${env}`, runs: [] }] }],
      })),
    },
    branch: 'develop',
    targetEnv: 'ci',
    width: 80,
  };
  const text = jobTabLines(input, deploy).map(lineText);
  expect(text.some((line) => line.includes('Deploy to *'))).toBe(true);
  expect(
    text.some((line) => line.includes('ci') && line.includes('#7') && line.includes('develop')),
  ).toBe(true);
  expect(text.some((line) => line.includes('deploy_qa'))).toBe(true);
});
