import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import type { Session } from '../../types';
import BranchesView, { type BranchesViewProps } from '.';

const local = { name: 'fix/local', sha: 'abc' };
const remote = { name: 'feature/selected-in-app', sha: 'def' };
const dataFor = (loaded: boolean): BranchesViewProps['data'] => ({
  branch: remote.name,
  current: local.name,
  branches: loaded ? [remote] : undefined,
  allBranches: false,
  connections: {},
  loadBranches: () => {},
  selectBranch: () => {},
});

for (const delayed of [false, true])
  test(`the cursor follows the app branch ${delayed ? 'after remote branches arrive' : 'instead of a stale saved cursor or Git checkout'}`, async () => {
    const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
    stdout.on('data', () => {});
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      setRawMode: () => {},
      ref: () => {},
      unref: () => {},
    });
    const session: Session = { tab: 'branches', selected: { branches: local.name } };
    const view = (loaded: boolean) => (
      <BranchesView
        data={dataFor(loaded)}
        session={session}
        watch={['main']}
        startFiltering={false}
        onCaptureInput={() => {}}
        onPicked={() => {}}
      />
    );
    const app = render(view(!delayed), {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (delayed) {
        //? Nothing listed yet: the checkout's branch is never offered in the meantime
        expect(session.selected.branches).not.toBe(remote.name);
        app.rerender(view(true));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      expect(session.selected.branches).toBe(remote.name);
    } finally {
      app.unmount();
    }
  });
