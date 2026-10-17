import { expect, test } from 'bun:test';

import type { ChainStep } from '../../../core/chain';
import { layoutGraph } from '../../../core/graph';

import { progressColumns } from './progress';

const steps = [
  { id: 'push' },
  { id: 'nginx', after: ['push'] },
  { id: 'nodejs', after: ['push'] },
  { id: 'deploy', after: ['nginx', 'nodejs'] },
  { id: 'propagate', after: ['deploy'] },
];
const levels = layoutGraph(steps, 41);
const chain = (done: string[], next: string[]): ChainStep[] =>
  steps.map((step) => ({
    step: { ...step, label: step.id, provider: 'test', kind: 'job' },
    status: { state: done.includes(step.id) ? 'done' : 'stale', summary: '' },
    recommended: next.includes(step.id),
    protected: false,
  }));
const columns = (entries: ChainStep[], row: number) =>
  progressColumns(entries, levels[row]!.nodes, levels[row + 1]!.nodes);

test('parallel builds share one green marker after their completed push', () => {
  expect(columns(chain(['push'], ['nginx', 'nodejs']), 0)).toEqual([20]);
});
test('finished builds share the junction before deploy', () => {
  expect(columns(chain(['push', 'nginx', 'nodejs'], ['deploy']), 1)).toEqual([20]);
});
test('deploy completion marks the boundary before propagate', () => {
  expect(columns(chain(['push', 'nginx', 'nodejs', 'deploy'], ['propagate']), 2)).toEqual([20]);
});
test('one remaining build marks only its own incoming connector', () => {
  expect(columns(chain(['push', 'nginx'], ['nodejs']), 0)).toEqual([31]);
});
test('no marker without a completed predecessor or recommended next step', () => {
  expect(columns(chain([], ['nginx']), 0)).toEqual([]);
  expect(columns(chain(['push'], []), 0)).toEqual([]);
});
