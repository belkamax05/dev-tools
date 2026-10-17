import { expect, test } from 'bun:test';

import type { JenkinsBuild } from './api';
import { otherActiveRuns } from './activeRuns';

const build = (number: number, branch: string, building = true): JenkinsBuild => ({
  number,
  building,
  timestamp: 1000,
  duration: 2000,
  result: building ? null : 'SUCCESS',
  url: `https://ci/job/build/${number}/`,
  actions: [{ parameters: [{ name: 'CODE_BRANCH', value: branch }] }],
});

test('reports running builds on other branches when the selected branch has no running build', () => {
  const result = otherActiveRuns(
    [
      build(4, 'feature/other'),
      build(3, 'feature/selected', false),
      build(2, 'release/other', false),
    ],
    'CODE_BRANCH',
    'feature/selected',
    4000,
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: '4',
    branch: 'feature/other',
    state: 'running',
    durationMs: 3000,
  });
});
test('excludes the selected branch, keeps simultaneous builds and removes finished builds', () => {
  const builds = [
    build(5, 'feature/selected'),
    build(4, 'feature/other'),
    build(3, 'release/other'),
  ];
  expect(otherActiveRuns(builds, 'CODE_BRANCH', 'feature/selected').map((run) => run.id)).toEqual([
    '4',
    '3',
  ]);
  builds[1]!.building = false;
  expect(otherActiveRuns(builds, 'CODE_BRANCH', 'feature/selected').map((run) => run.id)).toEqual([
    '3',
  ]);
});
test('does not invent branch ownership for a job without a branch parameter', () => {
  expect(otherActiveRuns([build(4, 'feature/other')], undefined, 'feature/selected')).toEqual([]);
});
