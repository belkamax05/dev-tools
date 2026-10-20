import { expect, test } from 'bun:test';

import type { JenkinsBuild } from './api';
import { branchSourceOf, jenkinsBranches } from './branches';

const build = (number: number, day: number, branch: string, result = 'SUCCESS'): JenkinsBuild => ({
  number,
  result,
  building: false,
  timestamp: Date.UTC(2026, 9, day),
  duration: 60_000,
  url: `https://ci/job/build_ts-app/${number}/`,
  actions: [{ parameters: [{ name: 'CODE_BRANCH', value: branch }] }],
});

const definitions = [
  {
    name: 'CODE_BRANCH',
    type: 'ChoiceParameterDefinition',
    choices: ['release-26.13', 'release-26.14', 'develop', 'master'],
  },
];
const source = { job: 'build_ts-app', param: 'CODE_BRANCH' };

test("a job's choices and the branches it built, newest build first, unbuilt choices last", () => {
  const heads = jenkinsBranches(
    definitions,
    [
      build(3733, 19, 'release-26.14'),
      build(3732, 15, 'release-26.14'),
      build(3731, 12, 'dfs2-9121-upgrade', 'FAILURE'),
      build(3335, 1, 'master'),
    ],
    source,
  );
  expect(heads.map((head) => head.name)).toEqual([
    'release-26.14',
    'dfs2-9121-upgrade',
    'master',
    'release-26.13',
    'develop',
  ]);
  expect(heads[0]).toMatchObject({
    sha: '',
    committedAt: '2026-10-19T00:00:00.000Z',
    message: "build_ts-app #3733 success · one of CODE_BRANCH's choices",
  });
  expect(heads[1]?.message).toContain("not in CODE_BRANCH's choices now");
  expect(heads[3]?.committedAt).toBeUndefined();
});

test('patterns narrow the list; a source without job and param is refused', () => {
  const heads = jenkinsBranches(definitions, [], source, ['release-*']);
  expect(heads.map((head) => head.name)).toEqual(['release-26.13', 'release-26.14']);
  expect(branchSourceOf(source)).toEqual(source);
  expect(() => branchSourceOf({ job: 'build_ts-app' })).toThrow('{ job, param }');
});
