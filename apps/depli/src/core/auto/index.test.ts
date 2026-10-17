import { expect, test } from 'bun:test';

import type { ChainStep } from '../chain';
import type { StepState } from '../plugin';
import { ancestorsOf, canArm, decideAuto, estimateAutos, formatEstimate } from '.';

//? push → build → deploy → propagate, each step's state and recommendation from the table
const chain = (states: Record<string, StepState>, next: string[] = []): ChainStep[] =>
  ['push', 'build', 'deploy', 'propagate'].map((id, at, ids) => ({
    step: {
      id,
      label: id,
      provider: 'test',
      kind: 'job',
      after: at ? [ids[at - 1] as string] : undefined,
    },
    status: { state: states[id] ?? 'done', summary: '' },
    recommended: next.includes(id),
    protected: false,
  }));
const entry = (entries: ChainStep[], id: string) =>
  entries.find((item) => item.step.id === id) as ChainStep;

test('ancestors are every step before, not only the direct parent', () => {
  const entries = chain({});
  expect(ancestorsOf(entries, 'propagate').map((item) => item.step.id)).toEqual([
    'push',
    'build',
    'deploy',
  ]);
});

test('only a step that is behind, with something before it running, can be armed', () => {
  const running = chain({ build: 'running', deploy: 'stale', propagate: 'none' });
  expect(canArm(running, entry(running, 'deploy'))).toBe(true);
  //? Two levels below the running build counts too
  expect(canArm(running, entry(running, 'propagate'))).toBe(true);
  const idle = chain({ deploy: 'stale' }, ['deploy']);
  expect(canArm(idle, entry(idle, 'deploy'))).toBe(false);
  const done = chain({ build: 'running' });
  expect(canArm(done, entry(done, 'deploy'))).toBe(false);
});

test('an armed step lets the steps after it be armed behind it', () => {
  const entries = chain({ deploy: 'stale', propagate: 'stale' }, ['deploy']);
  expect(canArm(entries, entry(entries, 'propagate'))).toBe(false);
  expect(canArm(entries, entry(entries, 'propagate'), new Set(['deploy']))).toBe(true);
});

test('waits while a step before it runs, fires once it is next', () => {
  expect(decideAuto(chain({ build: 'running', deploy: 'stale' }), 'deploy')).toEqual({
    kind: 'wait',
    reason: 'waiting on build',
  });
  expect(decideAuto(chain({ deploy: 'stale' }, ['deploy']), 'deploy')).toEqual({ kind: 'fire' });
});

test('a step armed behind another armed one waits for it', () => {
  const entries = chain({ deploy: 'stale', propagate: 'stale' }, ['deploy']);
  expect(decideAuto(entries, 'propagate', new Set(['deploy'])).kind).toBe('wait');
});

test('dropped, never sent, when the chain went elsewhere', () => {
  expect(decideAuto(chain({ build: 'failed', deploy: 'stale' }), 'deploy')).toEqual({
    kind: 'drop',
    reason: 'build is failed',
  });
  expect(decideAuto(chain({ build: 'running', deploy: 'running' }), 'deploy').kind).toBe('drop');
  expect(decideAuto(chain({}), 'deploy').kind).toBe('drop');
  //? The step before it is behind and nothing will run it: never its turn
  expect(decideAuto(chain({ build: 'stale', deploy: 'stale' }), 'deploy').kind).toBe('drop');
  expect(decideAuto(chain({}), 'gone').kind).toBe('drop');
});

//? push → (nginx ∥ nodejs) → deploy: past runs give each step its usual time
const MIN = 60_000;
const parallel = (
  states: Record<string, StepState>,
  usual: Record<string, number>,
  runningFor: Record<string, number> = {},
): ChainStep[] =>
  [
    { id: 'push' },
    { id: 'nginx', after: ['push'] },
    { id: 'nodejs', after: ['push'] },
    { id: 'deploy', after: ['nginx', 'nodejs'] },
  ].map((step) => ({
    step: { ...step, label: step.id, provider: 'test', kind: 'job' },
    status: {
      state: states[step.id] ?? 'done',
      summary: '',
      runs: [
        ...(runningFor[step.id] !== undefined
          ? [
              {
                id: 'now',
                label: 'now',
                state: 'running' as const,
                at: 1_000 * MIN - runningFor[step.id]!,
              },
            ]
          : []),
        ...(usual[step.id] !== undefined
          ? [9, 10, 11].map((factor) => ({
              id: `${factor}`,
              label: `${factor}`,
              state: 'success' as const,
              durationMs: (usual[step.id]! * factor) / 10,
            }))
          : []),
      ],
    },
    recommended: false,
    protected: false,
  }));

test('a running step has its usual time left; the armed step after it adds its own', () => {
  const entries = parallel(
    { nginx: 'running', nodejs: 'done', deploy: 'stale' },
    { nginx: 10 * MIN, deploy: 4 * MIN },
    { nginx: 3 * MIN },
  );
  expect(estimateAutos(entries, new Set(['deploy']), 1_000 * MIN)).toEqual({
    deploy: { startsInMs: 7 * MIN, finishesInMs: 11 * MIN, known: true },
  });
});

test('steps side by side run together: the longest is waited for, never the sum', () => {
  const entries = parallel(
    { nginx: 'stale', nodejs: 'stale', deploy: 'stale' },
    { nginx: 10 * MIN, nodejs: 6 * MIN, deploy: 4 * MIN },
  );
  const estimates = estimateAutos(entries, new Set(['nginx', 'nodejs', 'deploy']), 1_000 * MIN);
  expect(estimates.nginx?.finishesInMs).toBe(10 * MIN);
  expect(estimates.nodejs?.finishesInMs).toBe(6 * MIN);
  expect(estimates.deploy).toEqual({ startsInMs: 10 * MIN, finishesInMs: 14 * MIN, known: true });
});

test('a step with no past run makes the estimate a lower bound', () => {
  const entries = parallel({ nginx: 'running', deploy: 'stale' }, { deploy: 4 * MIN }, {});
  const estimate = estimateAutos(entries, new Set(['deploy']), 1_000 * MIN).deploy!;
  expect(estimate.known).toBe(false);
  expect(formatEstimate(estimate.finishesInMs, estimate.known)).toBe('≥4m');
  expect(formatEstimate(90 * MIN, true)).toBe('~1h30m');
  expect(formatEstimate(20_000, true)).toBe('~20s');
});

test('a chain can be armed end to end: the blocked step after an armed one, sent when it succeeds', () => {
  //? build runs; deploy (stale) is armed; propagate waits on deploy, so reads blocked
  const running = chain({ build: 'running', deploy: 'stale', propagate: 'blocked' });
  expect(canArm(running, entry(running, 'propagate'))).toBe(true);
  expect(decideAuto(running, 'propagate', new Set(['deploy'])).kind).toBe('wait');
  //? build done, deploy sent and running: propagate still waits
  const deploying = chain({ deploy: 'running', propagate: 'blocked' });
  expect(decideAuto(deploying, 'propagate').kind).toBe('wait');
  //? deploy succeeded: propagate fires even if it still reads blocked (not "next")
  expect(decideAuto(chain({ propagate: 'blocked' }), 'propagate')).toEqual({ kind: 'fire' });
  //? deploy failed: propagate is dropped, never sent
  expect(decideAuto(chain({ deploy: 'failed', propagate: 'blocked' }), 'propagate').kind).toBe(
    'drop',
  );
});

test('a failed step armed for a retry does not drop the ones armed after it', () => {
  const entries = chain({ build: 'running', deploy: 'failed', propagate: 'blocked' });
  expect(canArm(entries, entry(entries, 'deploy'))).toBe(true);
  expect(decideAuto(entries, 'propagate', new Set(['deploy'])).kind).toBe('wait');
});
