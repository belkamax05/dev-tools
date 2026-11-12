import { expect, test } from 'bun:test';

import type { DepliProjectConfig } from '../../config/project';
import { inputFor, resolvePick, resolveProject } from '.';

const config: DepliProjectConfig = {
  providers: { ci: { plugin: 'jenkins', url: 'https://ci' } },
  picks: {
    scripts: { default: ({ branch }) => (branch === 'master' ? 'cromwell-master' : 'develop-9115') },
    fixed: { default: 'v1' },
    none: {},
  },
  linkedBranches: { fe: { flow: 'fe' } },
};
const step = { id: 'build', label: 'Build', provider: 'ci', kind: 'job' };

test('a pick is the value picked, else its default for the branch, else absent', () => {
  const project = { ...resolveProject('/tmp/p', config), picks: { scripts: { label: 'scripts' } } };
  expect(resolvePick(project, 'scripts', { branch: 'master', env: 'ci' })).toBe('cromwell-master');
  expect(resolvePick(project, 'scripts', { branch: 'develop', env: 'ci' })).toBe('develop-9115');
  project.picks.scripts = { label: 'scripts', value: 'develop-9115-node24' } as never;
  expect(resolvePick(project, 'scripts', { branch: 'master', env: 'ci' })).toBe('develop-9115-node24');
  expect(resolvePick(project, 'none', { branch: 'master', env: 'ci' })).toBeUndefined();
});

test('every step input has the picks, defaults worked out from the step’s own branch', () => {
  const project = {
    ...resolveProject('/tmp/p', config),
    linked: { fe: { flow: 'fe', label: 'FE', branch: 'master' } },
  };
  expect(inputFor(project, step, 'develop', 'ci').picks).toEqual({ scripts: 'develop-9115', fixed: 'v1' });
  //? branchFrom: the linked branch decides the default
  expect(inputFor(project, { ...step, branchFrom: 'fe' }, 'develop', 'ci').picks?.scripts).toBe(
    'cromwell-master',
  );
});

test('a suggest naming an unknown provider is a config problem', () => {
  const project = resolveProject('/tmp/p', {
    ...config,
    picks: { scripts: { suggest: { provider: 'nope' } } },
  });
  expect(project.problems).toContain('picks.scripts.suggest: no provider "nope"');
});
