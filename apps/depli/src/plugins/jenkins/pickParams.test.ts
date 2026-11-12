import { afterAll, expect, spyOn, test } from 'bun:test';

import type { PluginContext, StepInput } from '../../core/plugin';
import type { JenkinsOptions } from './api';
import { jenkinsPlugin } from '.';

//? build_fe-nginx as Jenkins defines it: BUILD_AND_DEPLOY_BRANCH is a choice list
const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () =>
  Response.json({
    property: [
      {
        parameterDefinitions: [
          { name: 'CODE_BRANCH', type: 'ChoiceParameterDefinition', choices: ['develop'] },
          {
            name: 'BUILD_AND_DEPLOY_BRANCH',
            type: 'ChoiceParameterDefinition',
            choices: ['develop-9115', 'cromwell-master'],
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
const input = (picks: Record<string, string>): StepInput => ({
  step: {
    id: 'build',
    label: 'Build',
    provider: 'jenkins',
    kind: 'job',
    job: 'build_fe-nginx',
    branchParam: 'CODE_BRANCH',
    params: { BUILD_AND_DEPLOY_BRANCH: 'from-params' },
    pickParams: { BUILD_AND_DEPLOY_BRANCH: 'build-and-deploy' },
  },
  branch: 'develop',
  env: 'ci',
  upstream: {},
  picks,
});

test('a pick param sends the pick, over a fixed param of the same name, labelled by its id', async () => {
  const plan = await jenkinsPlugin.steps.job!.plan!(context, input({ 'build-and-deploy': 'cromwell-master' }));
  expect(plan.params).toEqual({ CODE_BRANCH: 'develop', BUILD_AND_DEPLOY_BRANCH: 'cromwell-master' });
  expect(plan.sources?.BUILD_AND_DEPLOY_BRANCH).toBe('build-and-deploy');
  expect(plan.blockers).toEqual([]);
  expect(plan.fixes).toEqual([]);
});

test('a typed value outside the job’s list is added right before the send', async () => {
  const plan = await jenkinsPlugin.steps.job!.plan!(
    context,
    input({ 'build-and-deploy': 'develop-9115-node24' }),
  );
  expect(plan.params.BUILD_AND_DEPLOY_BRANCH).toBe('develop-9115-node24');
  expect(plan.fixes?.map((fix) => [fix.id, fix.beforeSend])).toEqual([
    ['add-choice:BUILD_AND_DEPLOY_BRANCH', true],
  ]);
});

test('with no value at all the plan is blocked', async () => {
  const plan = await jenkinsPlugin.steps.job!.plan!(context, input({}));
  expect(plan.blockers).toEqual([
    'BUILD_AND_DEPLOY_BRANCH: nothing picked for build-and-deploy, and it has no default',
  ]);
});
