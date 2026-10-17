import { describe, expect, test } from 'bun:test';

import { evaluateChain } from '../chain';
import { connectAll } from '../connection';
import { definePlugin, type StepRun } from '../plugin';
import { resolveProject } from '../registry';
import { stopRun } from '.';

const RUNNING: StepRun = { id: '12', label: '#12', state: 'running', url: 'fake://12' };

/** A provider whose job is running and whose stops are recorded — no network in here. */
const setup = async (triggers = true) => {
  const stopped: string[] = [];
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
      job: {
        status: async () => ({ state: 'running', summary: 'building', runs: [RUNNING] }),
        stop: async (_, _input, run) => {
          stopped.push(run.id);
          return `stopped ${run.label}`;
        },
      },
    },
  });
  const project = resolveProject('/tmp/depli-test', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    envs: [{ id: 'qa' }, { id: 'live', protected: true }],
    pipeline: [{ id: 'deploy', label: 'Deploy', provider: 'ci', kind: 'job', job: 'deploy_{env}' }],
    triggers: { enabled: triggers },
  });
  const connections = await connectAll(project, {});
  const stop = async (
    env: string,
    confirmation: { confirmed: boolean; protectedEnv?: string },
    run = RUNNING,
  ) => {
    const [entry] = await evaluateChain(project, connections, {}, 'main', env);
    return stopRun(
      project,
      connections,
      {},
      entry!,
      run,
      { branch: 'main', targetEnv: env },
      confirmation,
    );
  };
  return { stopped, stop };
};

describe('stop gate', () => {
  test('stops a running build once confirmed', async () => {
    const { stopped, stop } = await setup();
    expect(await stop('qa', { confirmed: true })).toBe('stopped #12');
    expect(stopped).toEqual(['12']);
  });

  test('refuses without confirmation, with triggers off, or a run that is not running', async () => {
    const off = await setup(false);
    await expect(off.stop('qa', { confirmed: true })).rejects.toThrow('triggers are off');
    const { stopped, stop } = await setup();
    await expect(stop('qa', { confirmed: false })).rejects.toThrow('not confirmed');
    await expect(stop('qa', { confirmed: true }, { ...RUNNING, state: 'success' })).rejects.toThrow(
      'not running',
    );
    expect([...off.stopped, ...stopped]).toEqual([]);
  });

  test('a protected env is stopped only by typing its name', async () => {
    const { stopped, stop } = await setup();
    await expect(stop('live', { confirmed: true })).rejects.toThrow('protected');
    await expect(stop('live', { confirmed: true, protectedEnv: 'qa' })).rejects.toThrow(
      'protected',
    );
    expect(await stop('live', { confirmed: true, protectedEnv: 'live' })).toBe('stopped #12');
    expect(stopped).toEqual(['12']);
  });
});
