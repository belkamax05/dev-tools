import { describe, expect, test } from 'bun:test';

import type { DepliProjectConfig } from '../../config/project';
import { evaluateChain } from '../chain';
import { connectAll } from '../connection';
import { definePlugin, type TriggerPlan } from '../plugin';
import { resolveProject } from '../registry';
import { applyFix, planTrigger, sendTrigger } from '.';

/** A provider that records sends instead of making them — no network anywhere in here. */
const fake = () => {
  const sent: TriggerPlan[] = [];
  const plugin = definePlugin({
    id: 'fake',
    label: 'Fake',
    icon: '🧪',
    transports: [
      {
        id: 'api',
        label: 'api',
        capabilities: ['trigger'],
        probe: async () => ({ ok: true, detail: 'ok' }),
      },
    ],
    steps: {
      head: {
        status: async () => ({
          state: 'done',
          summary: 'head',
          ref: { sha: 'abc', buildNumber: 7 },
        }),
      },
      job: {
        status: async () => ({ state: 'stale', summary: 'behind', ref: { buildNumber: 1 } }),
        plan: async (_, input) => ({
          target: input.step.id,
          method: 'POST',
          url: `fake://${input.env}`,
          params: { BRANCH: input.branch },
        }),
        send: async (_, plan) => {
          sent.push(plan);
          return {};
        },
      },
    },
  });
  return { sent, plugin };
};

const setup = async (overrides: Partial<DepliProjectConfig> = {}) => {
  const { sent, plugin } = fake();
  const project = resolveProject('/tmp/depli-test', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    envs: [{ id: 'qa' }, { id: 'prod', protected: true }],
    pipeline: [
      { id: 'push', label: 'Push', provider: 'ci', kind: 'head' },
      {
        id: 'deploy',
        label: 'Deploy',
        provider: 'ci',
        kind: 'job',
        job: 'deploy_{env}',
        after: ['push'],
      },
    ],
    triggers: { enabled: true },
    ...overrides,
  });
  const connections = await connectAll(project, {});
  const chainFor = (env: string) => evaluateChain(project, connections, {}, 'main', env);
  const plan = async (env: string) =>
    planTrigger(project, connections, {}, await chainFor(env), 'deploy', 'main', env);
  const send = async (env: string, confirmation: { confirmed: boolean; protectedEnv?: string }) =>
    sendTrigger(project, connections, {}, await plan(env), { ...confirmation, targetEnv: env });
  return { sent, chainFor, plan, send };
};

describe('trigger gate', () => {
  test('recommends the first stale step whose upstream is done', async () => {
    const { chainFor } = await setup();
    const chain = await chainFor('qa');
    expect(chain.map((entry) => entry.recommended)).toEqual([false, true]);
  });

  test('refuses everything while triggers are off', async () => {
    const { sent, send, plan } = await setup({ triggers: { enabled: false } });
    expect((await plan('qa')).blockers).toContain(
      'triggers are off (triggers.enabled in depli.config.ts)',
    );
    await expect(send('qa', { confirmed: true })).rejects.toThrow('triggers are off');
    expect(sent).toHaveLength(0);
  });

  test('refuses without confirmation', async () => {
    const { sent, send } = await setup();
    await expect(send('qa', { confirmed: false })).rejects.toThrow('not confirmed');
    expect(sent).toHaveLength(0);
  });

  test('a protected env needs its own name, not just a yes', async () => {
    const { sent, send } = await setup();
    await expect(send('prod', { confirmed: true })).rejects.toThrow('prod is protected');
    await expect(send('prod', { confirmed: true, protectedEnv: 'qa' })).rejects.toThrow(
      'protected',
    );
    expect(sent).toHaveLength(0);
    await send('prod', { confirmed: true, protectedEnv: 'prod' });
    expect(sent).toHaveLength(1);
  });

  test('marks only env-scoped steps as protected', async () => {
    const { chainFor } = await setup();
    const chain = await chainFor('prod');
    expect(chain.map((entry) => [entry.step.id, entry.protected])).toEqual([
      ['push', false],
      ['deploy', true],
    ]);
  });

  test('sends once open and confirmed', async () => {
    const { sent, send } = await setup();
    await send('qa', { confirmed: true });
    expect(sent).toEqual([
      { target: 'deploy', method: 'POST', url: 'fake://qa', params: { BRANCH: 'main' } },
    ]);
  });
});

describe('fix gate', () => {
  const setupFix = async (enabled: boolean) => {
    const applied: string[] = [];
    const plugin = definePlugin({
      id: 'fixable',
      label: 'Fixable',
      icon: '🧪',
      transports: [
        {
          id: 'api',
          label: 'api',
          capabilities: ['trigger'],
          probe: async () => ({ ok: true, detail: 'ok' }),
        },
      ],
      steps: {
        job: {
          status: async () => ({ state: 'none', summary: 'never ran' }),
          plan: async () => ({
            target: 'build_x',
            method: 'POST',
            url: 'fake://build_x',
            params: { BRANCH: 'fix/a' },
            blockers: ['BRANCH=fix/a is not one of the choices'],
            fixes: [
              {
                id: 'add-choice:BRANCH',
                label: 'Add fix/a',
                detail: 'edits build_x',
              },
            ],
          }),
          fix: async (_, plan, fixId) => {
            applied.push(`${plan.target}:${fixId}`);
            return 'added';
          },
        },
      },
    });
    const project = resolveProject('/tmp/depli-fix', {
      plugins: [plugin],
      providers: { ci: { plugin: 'fixable' } },
      envs: [{ id: 'qa' }],
      pipeline: [{ id: 'build', label: 'Build', provider: 'ci', kind: 'job', job: 'build_x' }],
      triggers: { enabled },
    });
    const connections = await connectAll(project, {});
    const chain = await evaluateChain(project, connections, {}, 'fix/a', 'qa');
    const planned = await planTrigger(project, connections, {}, chain, 'build', 'fix/a', 'qa');
    const fix = (confirmed: boolean) =>
      applyFix(project, connections, {}, planned, 'add-choice:BRANCH', confirmed);
    return { applied, planned, fix };
  };

  test('a refused value blocks the trigger but offers its fix', async () => {
    const { planned } = await setupFix(true);
    expect(planned.blockers).toContain('BRANCH=fix/a is not one of the choices');
    expect(planned.plan.fixes?.[0]?.id).toBe('add-choice:BRANCH');
  });

  test('applied only once confirmed', async () => {
    const { applied, fix } = await setupFix(true);
    await expect(fix(false)).rejects.toThrow('not confirmed');
    expect(applied).toEqual([]);
    expect(await fix(true)).toBe('added');
    expect(applied).toEqual(['build_x:add-choice:BRANCH']);
  });

  test('refused while triggers are off, even confirmed', async () => {
    const { applied, fix } = await setupFix(false);
    await expect(fix(true)).rejects.toThrow('triggers are off');
    expect(applied).toEqual([]);
  });
});
