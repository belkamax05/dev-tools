import { afterAll, expect, spyOn, test } from 'bun:test';

import type { PluginContext, StepInput } from '../../core/plugin';
import type { JenkinsOptions } from './api';
import { jenkinsPlugin } from '.';

//? deploy_environment_ci as Jenkins defines it: FE_CODE_BRANCH is a choice list
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
  Response.json({
    property: [
      {
        parameterDefinitions: [
          { name: 'CODE_BRANCH', type: 'ChoiceParameterDefinition', choices: ['release-26.14'] },
          {
            name: 'FE_CODE_BRANCH',
            type: 'ChoiceParameterDefinition',
            choices: ['release-sprint-26.14', 'master'],
          },
        ],
      },
    ],
  })) as unknown as typeof fetch);
afterAll(() => fetchSpy.mockRestore());

const context = {
  cwd: '/tmp',
  env: { USER_ENV: 'u', TOKEN_ENV: 't' },
  options: { url: 'https://ci', userEnv: 'USER_ENV', tokenEnv: 'TOKEN_ENV' },
} as unknown as PluginContext<JenkinsOptions>;
const input = (branches: Record<string, string>): StepInput => ({
  step: {
    id: 'deploy',
    label: 'Full deploy',
    provider: 'jenkins',
    kind: 'job',
    job: 'deploy_environment_{env}',
    branchParam: 'CODE_BRANCH',
    linkedBranchParams: { FE_CODE_BRANCH: 'fe' },
  },
  branch: 'release-26.14',
  env: 'ci',
  upstream: {},
  branches,
});

test('a linked branch param sends the other flow’s pick, labelled as such', async () => {
  const plan = await jenkinsPlugin.steps.job!.plan!(context, input({ fe: 'release-sprint-26.14' }));
  expect(plan.params).toEqual({ CODE_BRANCH: 'release-26.14', FE_CODE_BRANCH: 'release-sprint-26.14' });
  expect(plan.sources).toEqual({ CODE_BRANCH: 'branch', FE_CODE_BRANCH: 'fe branch' });
  expect(plan.blockers).toEqual([]);
});

test('without that pick the plan is blocked rather than sent without it', async () => {
  const plan = await jenkinsPlugin.steps.job!.plan!(context, input({}));
  expect(plan.params.FE_CODE_BRANCH).toBeUndefined();
  expect(plan.blockers).toEqual(['FE_CODE_BRANCH: no fe branch picked — pick one in that flow']);
});
