import { expect, test } from 'bun:test';

import { layoutGraph } from '../../../core/graph';

import { connectorOwner } from './connectors';

const levels = layoutGraph(
  [
    { id: 'push' },
    { id: 'nginx', after: ['push'] },
    { id: 'nodejs', after: ['push'] },
    { id: 'deploy', after: ['nginx', 'nodejs'] },
  ],
  41,
);

test('horizontal lines beside the merge dot belong to completed builds, not deploy', () => {
  const builds = levels[1]!.nodes;
  const deploy = levels[2]!.nodes;
  for (let column = builds[0]!.center; column < deploy[0]!.center; column++) {
    expect(connectorOwner(column, builds, deploy)?.id).toBe('nginx');
  }
  for (let column = deploy[0]!.center + 1; column <= builds[1]!.center; column++) {
    expect(connectorOwner(column, builds, deploy)?.id).toBe('nodejs');
  }
});

test('a split uses each outgoing build on its side of the push junction', () => {
  const push = levels[0]!.nodes;
  const builds = levels[1]!.nodes;
  expect(connectorOwner(15, push, builds)?.id).toBe('nginx');
  expect(connectorOwner(25, push, builds)?.id).toBe('nodejs');
});

test('the horizontal path to a dot on the left build keeps the upper action color', () => {
  const push = levels[0]!.nodes;
  const builds = levels[1]!.nodes;
  const dot = builds[0]!.center;
  for (let column = dot + 1; column <= push[0]!.center; column++) {
    expect(connectorOwner(column, push, builds, [dot])?.id).toBe('push');
  }
  expect(connectorOwner(25, push, builds, [dot])?.id).toBe('nodejs');
});

test('the same boundary coloring applies when the remaining build is on the right', () => {
  const push = levels[0]!.nodes;
  const builds = levels[1]!.nodes;
  const dot = builds[1]!.center;
  for (let column = push[0]!.center; column < dot; column++) {
    expect(connectorOwner(column, push, builds, [dot])?.id).toBe('push');
  }
  expect(connectorOwner(15, push, builds, [dot])?.id).toBe('nginx');
});
