import { expect, test } from 'bun:test';

import type { InkRender } from '../../../types/InkRender';
import runTuiSession from '.';

test('screen handoffs await the shared screen and restore the dashboard after cancel or save', async () => {
  const events: string[] = [];
  let visits = 0;
  const render: InkRender = () => ({
    rerender: () => {},
    unmount: () => {},
    cleanup: () => {},
    clear: () => {},
    waitUntilExit: async () => {
      events.push('dashboard released');
    },
  });

  await runTuiSession(
    ({ handoff, notice }) => {
      visits++;
      events.push(`dashboard ${visits}`);
      if (visits > 1) expect(notice).toBe('Back from Commit');
      if (visits <= 2) {
        const outcome = visits === 1 ? 'cancel' : 'save';
        handoff({
          type: 'screen',
          label: 'Commit',
          open: async () => {
            events.push('commit opened');
            await Promise.resolve();
            events.push(outcome);
          },
        });
      }
      return null;
    },
    {
      render,
      afterHandoff: () => {
        events.push('refresh');
      },
    },
  );

  expect(events).toEqual([
    'dashboard 1',
    'dashboard released',
    'commit opened',
    'cancel',
    'refresh',
    'dashboard 2',
    'dashboard released',
    'commit opened',
    'save',
    'refresh',
    'dashboard 3',
    'dashboard released',
  ]);
});
