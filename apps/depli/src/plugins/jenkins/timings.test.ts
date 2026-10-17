import { expect, spyOn, test } from 'bun:test';

import {
  compareTimings,
  readJenkinsTimings,
  type WorkflowRun,
  type WorkflowStage,
} from './timings';

const stage = (
  name: string,
  durationMillis: number,
  status = 'SUCCESS',
  id = name,
): WorkflowStage => ({ id, name, durationMillis, status });
const run = (id: string, stages: WorkflowStage[], status = 'SUCCESS'): WorkflowRun => ({
  id,
  status,
  stages,
});

test('compares matching stage names across changed node IDs using only five earlier successful builds', () => {
  const current = run('10', [stage('Build', 7000, 'SUCCESS', '52')]);
  const history = [
    run('11', [stage('Build', 90000)]),
    run('10', [stage('Build', 90000)]),
    run('9', [stage('Build', 90000)], 'FAILED'),
    ...[8, 7, 6, 5, 4, 3].map((id) =>
      run(String(id), [stage('Build', id * 1000, 'SUCCESS', '17')]),
    ),
  ];
  const result = compareTimings(current, history);
  expect(result.previousRuns).toEqual(['8', '7', '6', '5', '4']);
  expect(result.stages[0]?.averageMs).toBe(6000);
  expect(result.stages[0]?.durationMs).toBe(7000);
  expect(result.more).toBe(false);
});
test('a running stage has live elapsed time and later historical stages are marked pending', () => {
  const build = { ...stage('Build', 0, 'IN_PROGRESS'), startTimeMillis: 1000 };
  const result = compareTimings(
    run('2', [build], 'IN_PROGRESS'),
    [run('1', [stage('Build', 5000), stage('Push image', 1000)])],
    4000,
  );
  expect(result.stages[0]?.durationMs).toBe(3000);
  expect(result.stages[1]).toMatchObject({
    label: 'Push image',
    state: 'pending',
    averageMs: 1000,
  });
  expect(result.more).toBe(true);
});
test('paused stages retain Jenkins duration and keep polling', () => {
  const result = compareTimings(
    run(
      '2',
      [{ ...stage('Approve', 1000, 'PAUSED_PENDING_INPUT'), startTimeMillis: 1 }],
      'PAUSED_PENDING_INPUT',
    ),
    [],
    90000,
  );
  expect(result.stages[0]).toMatchObject({ state: 'paused', durationMs: 1000 });
  expect(result.more).toBe(true);
});
test('duplicate stage names are compared by occurrence, not unrelated node ids', () => {
  const result = compareTimings(run('2', [stage('Test', 400), stage('Test', 800)]), [
    run('1', [stage('Test', 200), stage('Test', 600)]),
  ]);
  expect(result.stages.map((item) => item.averageMs)).toEqual([200, 600]);
  expect(new Set(result.stages.map((item) => item.id)).size).toBe(2);
});
test('a first build has no invented baseline or pending stages', () => {
  const result = compareTimings(run('1', [stage('Build', 200)]), []);
  expect(result.stages[0]?.averageMs).toBeUndefined();
  expect(result.stages[0]?.samples).toBe(0);
  expect(result.previousRuns).toEqual([]);
});
test('a completed build does not imply stages omitted by its dynamic pipeline are still pending', () => {
  const result = compareTimings(run('2', [stage('Build', 200)]), [
    run('1', [stage('Build', 200), stage('Deploy', 300)]),
  ]);
  expect(result.stages.map((item) => item.label)).toEqual(['Build']);
});
test('jobs without the stage API report unavailability without failing the chain', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
  try {
    const result = await readJenkinsTimings(
      { url: 'https://ci.example.com', userEnv: 'USER', tokenEnv: 'TOKEN' },
      { USER: 'test', TOKEN: 'test' },
      'folder/job',
      '1',
    );
    expect(result.unavailable).toContain('Stage timings are unavailable');
    expect(result.more).toBe(false);
    expect(fetch.mock.calls[0]?.[0]).toBe(
      'https://ci.example.com/job/folder/job/job/1/wfapi/describe',
    );
  } finally {
    fetch.mockRestore();
  }
});

test('overall estimate uses wall-clock build duration rather than summing parallel stages', () => {
  const current = {
    ...run(
      '3',
      [stage('Build A', 3000, 'IN_PROGRESS'), stage('Build B', 3000, 'IN_PROGRESS')],
      'IN_PROGRESS',
    ),
    startTimeMillis: 1000,
  };
  const history = [
    { ...run('2', [stage('Build A', 5000), stage('Build B', 5000)]), durationMillis: 6000 },
    {
      ...run('1', [stage('Build A', 7000), stage('Build B', 7000)]),
      startTimeMillis: 1000,
      endTimeMillis: 9000,
    },
  ];
  const result = compareTimings(current, history, 4000);
  expect(result.elapsedMs).toBe(3000);
  expect(result.estimatedTotalMs).toBe(7000);
});

test('overall timings report the final result even while the chain still thinks the job is running', () => {
  expect(compareTimings(run('2', [], 'IN_PROGRESS'), []).state).toBe('running');
  expect(compareTimings(run('2', [], 'SUCCESS'), []).state).toBe('success');
  expect(compareTimings(run('2', [], 'FAILED'), []).state).toBe('failure');
  expect(compareTimings(run('2', [], 'ABORTED'), []).state).toBe('aborted');
});
