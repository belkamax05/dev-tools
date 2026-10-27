import { expect, test } from 'bun:test';

import type { ChainStep } from '../../../core/chain';
import type { EnvRow } from '../../../core/matrix';
import type { StepConfig } from '../../../core/plugin';
import { envHeader, envLine, envTable, envTags } from '.';

const step = (id: string, extra: Partial<StepConfig> = {}) =>
  ({ id, label: id, provider: 'jenkins', kind: 'job', ...extra }) as StepConfig;

const deployStep = step('deploy', {
  versions: { FE_NGINX_VERSION: 'build-nginx', FE_NODE_VERSION: 'build-nodejs' },
} as Partial<StepConfig>);

const chain = [
  { step: step('build-nginx'), status: { state: 'done', summary: '', ref: { buildNumber: 1023 } } },
  {
    step: step('build-nodejs'),
    status: { state: 'done', summary: '', ref: { buildNumber: 3283 } },
  },
] as unknown as ChainStep[];

const hoursAgo = (hours: number) => Date.now() - hours * 3_600_000;

const row: EnvRow = {
  env: 'ci3',
  protected: false,
  cells: [
    {
      step: deployStep,
      latest: {
        state: 'done',
        summary: '#840',
        branch: 'release-sprint-26.14',
        versions: {
          FE_NGINX_VERSION: '1.0.x-release-sprint-26-14.1020',
          FE_NODE_VERSION: '1.0.x-release-sprint-26-14.3283',
        },
        at: hoursAgo(44.4),
      },
    },
    { step: step('propagate'), latest: { state: 'done', summary: '#4545', at: hoursAgo(6) } },
  ],
};

test('a row says which build is behind and by how much, with the exact time and the age', () => {
  const line = envLine(row, { branch: 'release-sprint-26.14', chain });
  expect(line.mine).toBe(true);
  expect(line.stale).toBe(true);
  expect(line.text).toContain('#1020→1023');
  expect(line.text).toContain('#3283 ');
  expect(line.text).toContain('44h24m ago');
  expect(line.summary).toContain('deployed');
});

test('another branch on the env is never behind — its build numbers are not comparable', () => {
  const line = envLine(row, { branch: 'develop', chain });
  expect(line.stale).toBe(false);
  expect(line.text).not.toContain('→');
});

test('the current env keeps its behind tag', () => {
  const line = envLine(row, { branch: 'release-sprint-26.14', chain });
  expect(envTags(line, { protected: false, current: true })).toEqual(['current', 'behind']);
});

test('the header lines its columns up with the rows', () => {
  const line = envLine(row, { branch: 'release-sprint-26.14', chain }, 4);
  //? Rows are drawn after a 2-cell marker and the tags prefix (width + 1)
  const header = envHeader(row, 4, 6);
  const drawn = `  ${'x'.repeat(6)} ${line.text}`;
  for (const name of ['build-nginx', 'build-nodejs', 'propagate'])
    expect(drawn[header.indexOf(name)]).not.toBe(' ');
  expect(drawn.indexOf('#1020')).toBe(header.indexOf('build-nginx'));
});

test('the extended table adds MEANT FOR after the branch and tags an env off-track', () => {
  const colors = { error: 'red', warn: 'orange', accent: 'blue', ok: 'green' };
  const data = { branch: 'develop', chain, envs: [row], targetEnv: 'ci3' };
  const plain = envTable({ envIds: ['ci3'], protectedEnvs: [], data, colors });
  const extended = envTable({
    envIds: ['ci3'],
    protectedEnvs: [],
    data,
    colors,
    configs: [{ id: 'ci3', branches: ['develop'] }],
  });
  expect(plain.header).not.toContain('MEANT FOR');
  expect(plain.items[0]?.prefix.text.trim()).toBe('current');
  expect(extended.items[0]?.prefix).toEqual({ text: 'current · off-track', color: 'orange' });
  //? MEANT FOR sits between the branch and the build columns, in the header and the row alike
  const label = extended.items[0]?.label ?? '';
  const drawn = `  ${extended.items[0]?.prefix.text} ${label}`;
  expect(drawn.indexOf('develop')).toBe(extended.header.indexOf('MEANT FOR'));
  expect(label.indexOf('release-sprint-26.14')).toBeLessThan(label.indexOf('develop'));
  expect(label.indexOf('develop')).toBeLessThan(label.indexOf('#1020'));
});
