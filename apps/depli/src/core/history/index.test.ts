import { expect, test } from 'bun:test';

import type { EnvRow } from '../matrix';
import type { HistoryRun, StepConfig } from '../plugin';
import {
  branchRelations,
  deployedBuilds,
  findRun,
  type History,
  onTrack,
  runsByDay,
  versionNumber,
  versionsOf,
} from '.';

const deploy = {
  id: 'deploy',
  label: 'Deploy',
  provider: 'jenkins',
  kind: 'job',
  versions: { FE_NGINX_VERSION: 'build-nginx' },
} as StepConfig;

const row = (env: string, branch?: string, version?: string): EnvRow => ({
  env,
  protected: false,
  cells: [
    {
      step: deploy,
      latest: {
        state: 'done',
        summary: '#1',
        branch,
        versions: version ? { FE_NGINX_VERSION: version } : {},
      },
    },
  ],
});

const run = (id: number, at: number): HistoryRun => ({
  id: String(id),
  label: `#${id}`,
  state: 'success',
  at,
  url: `https://ci/job/x/${id}/`,
});

test('groups runs by the day they started, newest day first, order kept inside a day', () => {
  const day = (date: number, hour: number) => new Date(2026, 9, date, hour).getTime();
  const days = runsByDay([run(3, day(19, 15)), run(2, day(19, 9)), run(1, day(17, 12))]);
  expect(days.map((entry) => entry.day)).toEqual(['Mon 19 Oct 2026', 'Sat 17 Oct 2026']);
  expect(days[0]?.runs.map((entry) => entry.id)).toEqual(['3', '2']);
});

test('reads the build number a version ends in', () => {
  expect(versionNumber('1.0.x-release-26-13.1008')).toBe(1008);
  expect(versionNumber('latest')).toBeUndefined();
  expect(versionsOf(deploy, { params: { FE_NGINX_VERSION: '1.0.x.42' } })).toEqual([
    { param: 'FE_NGINX_VERSION', stepId: 'build-nginx', value: '1.0.x.42', number: 42 },
  ]);
});

test('finds a shared build run by number, for linking a deployed version to it', () => {
  const history: History = {
    shared: [
      { step: { ...deploy, id: 'build-nginx' }, jobs: [{ job: 'build', runs: [run(42, 1)] }] },
    ],
    envs: [],
    branches: {},
    readAt: 0,
  };
  expect(findRun(history, 'build-nginx', 42)?.url).toBe('https://ci/job/x/42/');
  expect(findRun(history, 'build-nginx', 7)).toBeUndefined();
});

test('maps each build to the envs running it now', () => {
  const builds = deployedBuilds([row('ci', 'develop', '1.0.x.42'), row('uat3', 'r', '1.0.x.42')]);
  expect(builds.get('build-nginx')?.get(42)).toEqual(['ci', 'uat3']);
});

test('an env is on track only when its configured branches match what it runs', () => {
  expect(onTrack({ branches: ['release-*'] }, 'release-26.16')).toBe(true);
  expect(onTrack({ branches: ['release-*', '!release-old-*'] }, 'release-old-1')).toBe(false);
  expect(onTrack({}, 'develop')).toBeUndefined();
  expect(onTrack({ branches: ['develop'] }, undefined)).toBeUndefined();
});

test('relates branches to envs: tracked, running, and running branches no pattern covers', () => {
  const relations = branchRelations(
    [{ id: 'ci', branches: ['develop'] }, { id: 'uat3', branches: ['release-*'] }, { id: 'perf' }],
    [row('ci', 'release-26.16'), row('uat3', 'release-26.16'), row('perf', 'master')],
  );
  expect(relations).toEqual([
    { branch: 'develop', tracks: ['ci'], runs: [] },
    { branch: 'release-*', tracks: ['uat3'], runs: ['ci', 'uat3'] },
    { branch: 'master', tracks: [], runs: ['perf'] },
  ]);
});
