import { expect, test } from 'bun:test';

import type { Connection, StepStatus } from '../plugin';
import type { Project } from '../registry';
import { evaluateChain } from '.';

//? A fake provider whose step kind reads each step's state from the table
const run = async (states: Record<string, StepStatus['state']>) => {
  const pipeline = [
    { id: 'push', provider: 'fake', kind: 'step' },
    { id: 'build', provider: 'fake', kind: 'step', after: ['push'] },
    { id: 'deploy', provider: 'fake', kind: 'step', after: ['build'] },
    { id: 'propagate', provider: 'fake', kind: 'step', after: ['deploy'] },
  ];
  const project = {
    config: { pipeline },
    providers: [
      {
        name: 'fake',
        plugin: {
          steps: {
            step: {
              status: async (_: unknown, { step }: { step: { id: string } }) => ({
                state: states[step.id]!,
                summary: '',
                ref: { sha: step.id },
              }),
            },
          },
        },
      },
    ],
  } as unknown as Project;
  const connections = { fake: { transport: {} } } as unknown as Record<string, Connection>;
  const chain = await evaluateChain(project, connections, {} as never, 'main', 'dev');
  return Object.fromEntries(chain.map((entry) => [entry.step.id, Boolean(entry.behind)]));
};

test('done steps under a stale one are behind, all the way down the done tail', async () => {
  expect(await run({ push: 'done', build: 'stale', deploy: 'done', propagate: 'done' })).toEqual({
    push: false,
    build: false,
    deploy: true,
    propagate: true,
  });
});
test('nothing is behind when every step before is done', async () => {
  expect(await run({ push: 'done', build: 'done', deploy: 'done', propagate: 'stale' })).toEqual({
    push: false,
    build: false,
    deploy: false,
    propagate: false,
  });
});
