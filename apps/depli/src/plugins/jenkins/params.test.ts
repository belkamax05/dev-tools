import { describe, expect, test } from 'bun:test';

import { checkParams, jenkinsErrorText, type ParamDefinition } from './params';

const BUILD_FE_NODEJS: ParamDefinition[] = [
  {
    name: 'BUILD_AND_DEPLOY_BRANCH',
    type: 'ChoiceParameterDefinition',
    choices: ['develop-9115', 'cromwell-master'],
  },
  {
    name: 'CODE_BRANCH',
    type: 'ChoiceParameterDefinition',
    choices: ['release-sprint-26.14', 'master'],
  },
];

describe('checkParams', () => {
  test('a branch outside the choice list blocks — Jenkins would answer 500', () => {
    const { blockers, warnings } = checkParams(
      { BUILD_AND_DEPLOY_BRANCH: 'develop-9115', CODE_BRANCH: 'fix/dfs2-36962/issue4' },
      BUILD_FE_NODEJS,
      'build_fe-nodejs',
    );
    expect(blockers).toEqual([
      "CODE_BRANCH=fix/dfs2-36962/issue4 is not one of build_fe-nodejs's choices (release-sprint-26.14, master) — Jenkins refuses it",
    ]);
    expect(warnings).toEqual([]);
  });

  test('values in the lists pass', () => {
    expect(
      checkParams(
        { BUILD_AND_DEPLOY_BRANCH: 'cromwell-master', CODE_BRANCH: 'master' },
        BUILD_FE_NODEJS,
        'build_fe-nodejs',
      ),
    ).toEqual({ blockers: [], warnings: [] });
  });

  test('an unknown parameter and a missing one are warnings, with the default named', () => {
    const { blockers, warnings } = checkParams(
      { CODE_BRANCH: 'master', TYPO: 'x' },
      [
        ...BUILD_FE_NODEJS,
        {
          name: 'ENABLE_CACHE_CLEAR_FLAG',
          type: 'BooleanParameterDefinition',
          defaultParameterValue: { value: true },
        },
      ],
      'job',
    );
    expect(blockers).toEqual([]);
    expect(warnings).toEqual([
      'TYPO is not a parameter of job — Jenkins ignores it',
      'BUILD_AND_DEPLOY_BRANCH is not sent — Jenkins uses its default',
      'ENABLE_CACHE_CLEAR_FLAG is not sent — Jenkins uses its default (true)',
    ]);
  });

  test('a cascade (Active Choices) parameter has no list to check against', () => {
    expect(
      checkParams(
        { FE_NGINX_VERSION: '1.0.x-release-sprint-26-13.1010' },
        [{ name: 'FE_NGINX_VERSION', type: 'CascadeChoiceParameter' }],
        'deploy',
      ).blockers,
    ).toEqual([]);
  });
});

describe('jenkinsErrorText', () => {
  test('the reason from a Jenkins error page', () => {
    const page = `<html><head><title>Jenkins</title><script>var x=1;</script></head><body>
      <h2>HTTP ERROR 500 java.lang.IllegalArgumentException: Illegal choice for parameter CODE_BRANCH: fix/a</h2>
      <pre>java.lang.IllegalArgumentException: Illegal choice for parameter CODE_BRANCH: fix/a
        at hudson.model.ChoiceParameterDefinition.checkValue</pre></body></html>`;
    expect(jenkinsErrorText(page)).toBe(
      'HTTP ERROR 500 java.lang.IllegalArgumentException: Illegal choice for parameter CODE_BRANCH: fix/a',
    );
  });

  test('an exception line when there is no known phrase', () => {
    expect(jenkinsErrorText('<pre>hudson.AbortException: No such job</pre>')).toBe('No such job');
  });

  test('nothing recognisable is undefined', () => {
    expect(jenkinsErrorText('<html><body>Oops</body></html>')).toBeUndefined();
  });
});
