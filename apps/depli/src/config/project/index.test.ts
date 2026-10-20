import { expect, test } from 'bun:test';

import { type DepliProjectConfig, resolveFlow, secretEnvNames } from '.';

const config: DepliProjectConfig = {
  providers: { jenkins: { plugin: 'jenkins', userEnv: 'CI_USER', tokenEnv: 'CI_TOKEN' } },
  triggers: { enabled: true },
  flows: {
    fe: {
      providers: { github: { plugin: 'github', repo: 'owner/fe' } },
      defaultEnv: 'qa',
      pipeline: [{ id: 'push', label: 'Push', provider: 'github', kind: 'branch' }],
    },
    be: {
      label: 'Backend',
      providers: { github: { plugin: 'github', repo: 'owner/be', tokenEnv: 'BE_GH_TOKEN' } },
      pipeline: [],
    },
  },
  defaultFlow: 'fe',
};

test('a flow is laid over the shared keys, providers merged by name', () => {
  const { config: be, flow, label, flows, error } = resolveFlow(config, 'be');
  expect([flow, label, flows, error]).toEqual(['be', 'Backend', ['fe', 'be'], undefined]);
  expect(Object.keys(be.providers ?? {})).toEqual(['jenkins', 'github']);
  expect(be.providers?.github?.repo).toBe('owner/be');
  expect(be.triggers).toEqual({ enabled: true });
  expect(be.pipeline).toEqual([]);
  expect(be.defaultEnv).toBeUndefined();
  expect('flows' in be || 'defaultFlow' in be || 'label' in be).toBe(false);
});

test('defaultFlow opens when none is named; an unknown one is reported, the default opened', () => {
  expect(resolveFlow(config).flow).toBe('fe');
  expect(resolveFlow({ ...config, defaultFlow: undefined }).flow).toBe('fe');
  expect(resolveFlow({ ...config, defaultFlow: 'be' }).flow).toBe('be');
  const unknown = resolveFlow(config, 'qa');
  expect(unknown.flow).toBe('fe');
  expect(unknown.error).toBe('no flow "qa" — flows: fe, be');
  expect(resolveFlow({ ...config, defaultFlow: 'nope' }).error).toContain('defaultFlow');
});

test('a config without flows is used as it is', () => {
  const single: DepliProjectConfig = { defaultEnv: 'qa' };
  expect(resolveFlow(single, 'be')).toEqual({ config: single, flows: [] });
});

test('the secrets of every flow are asked for', () => {
  expect(secretEnvNames(config)).toEqual(['CI_USER', 'CI_TOKEN', 'BE_GH_TOKEN']);
});
