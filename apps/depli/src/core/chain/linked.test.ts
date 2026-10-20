import { expect, test } from 'bun:test';

import { connectAll } from '../connection';
import { definePlugin, type StepInput } from '../plugin';
import { inputFor, resolveProject } from '../registry';
import { planTrigger } from '../trigger';
import { evaluateChain } from '.';

//? Records what each step was given; a build is "never run", so it would be recommended
const seen: Record<string, StepInput> = {};
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
      status: async (_, input) => {
        seen[input.step.id] = input;
        return { state: 'none', summary: `never run for ${input.branch}` };
      },
      plan: async (_, input) => ({ target: input.step.id, method: 'POST', url: 'fake://', params: {} }),
    },
  },
});

const project = (feBranch?: string) => {
  const resolved = resolveProject('/tmp/depli-linked', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    envs: [{ id: 'qa' }],
    triggers: { enabled: true },
    linkedBranches: { fe: { flow: 'fe' } },
    pipeline: [
      { id: 'build-be', label: 'Build be', provider: 'ci', kind: 'job' },
      {
        id: 'build-fe',
        label: 'Build fe',
        provider: 'ci',
        kind: 'job',
        branchFrom: 'fe',
        observeOnly: true,
      },
    ],
  });
  resolved.linked = { fe: { flow: 'fe', label: 'FE branch', branch: feBranch } };
  return resolved;
};

test('a step with branchFrom runs on the linked branch; every step is given them all', async () => {
  const linked = project('release-sprint-26.14');
  const connections = await connectAll(linked, {});
  const chain = await evaluateChain(linked, connections, {}, 'release-26.14', 'qa');
  expect(seen['build-be']?.branch).toBe('release-26.14');
  expect(seen['build-fe']?.branch).toBe('release-sprint-26.14');
  expect(seen['build-be']?.branches).toEqual({ fe: 'release-sprint-26.14' });
  //? Never run, both — only the one this flow triggers is recommended
  expect(chain.map((entry) => [entry.step.id, entry.recommended])).toEqual([
    ['build-be', true],
    ['build-fe', false],
  ]);
  await expect(
    planTrigger(linked, connections, {}, chain, 'build-fe', 'release-26.14', 'qa'),
  ).rejects.toThrow('observe-only');
  expect(
    (await planTrigger(linked, connections, {}, chain, 'build-be', 'release-26.14', 'qa')).blockers,
  ).toEqual([]);
});

test('nothing picked in the linked flow: its steps are blocked and say where to pick it', async () => {
  const linked = project(undefined);
  const chain = await evaluateChain(linked, await connectAll(linked, {}), {}, 'master', 'qa');
  expect(chain[1]?.status).toEqual({
    state: 'blocked',
    summary: "no FE branch picked yet — [F] picks it (the fe flow's branches)",
  });
  expect(inputFor(linked, chain[1]!.step, 'master', 'qa').branch).toBe('');
});

test('a branchFrom outside linkedBranches is a config problem', () => {
  const resolved = resolveProject('/tmp/depli-linked', {
    plugins: [plugin],
    providers: { ci: { plugin: 'fake' } },
    pipeline: [{ id: 'x', label: 'X', provider: 'ci', kind: 'job', branchFrom: 'fe' }],
  });
  expect(resolved.problems).toEqual(['pipeline.x: branchFrom "fe" is not in linkedBranches']);
});
