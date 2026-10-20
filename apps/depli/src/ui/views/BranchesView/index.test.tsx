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

test('the branch picker starts with arrow navigation and searches only after slash', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
  stdout.on('data', () => {});
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {},
  });
  const session: Session = { tab: 'chain', selected: {} };
  let captured = false;
  const app = render(
    <BranchesView
      data={{ ...dataFor(true), branches: [remote, local] }}
      session={session} watch={['main']}
      onCaptureInput={(value) => { captured = value; }}
      onPicked={() => {}}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  );
  const settle = () => Bun.sleep(80);
  try {
    await settle();
    expect(captured).toBe(false);
    expect(session.selected.branches).toBe(remote.name);
    stdin.write('\u001b[B');
    await settle();
    expect(session.selected.branches).toBe(local.name);
    stdin.write('/');
    await settle();
    expect(captured).toBe(true);
    stdin.write('fix');
    await settle();
    expect(session.branchFilter).toBe('fix');
    stdin.write('\r');
    await settle();
    expect(captured).toBe(false);
    expect(session.selected.branches).toBe(local.name);
  } finally {
    app.unmount();
  }
});

test('with custom, a typed name nobody listed can be picked as it is', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 100, rows: 30, isTTY: true });
  stdout.on('data', () => {});
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const picked: string[] = [];
  const session: Session = { tab: 'chain', selected: {} };
  const app = render(
    <BranchesView
      data={{ ...dataFor(true), selectBranch: (name) => picked.push(name) }}
      session={session}
      watch={[]}
      custom
      source="jenkins"
      onCaptureInput={() => {}}
      onPicked={() => {}}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    },
  );
  try {
    await Bun.sleep(80);
    stdin.write('/');
    await Bun.sleep(80);
    stdin.write('dfs2-9122-upgrade');
    await Bun.sleep(80);
    stdin.write('\r');
    await Bun.sleep(80);
    //? Nothing matches it: the typed name is the only row, picked with Enter
    stdin.write('\r');
    await Bun.sleep(80);
    expect(picked).toEqual(['dfs2-9122-upgrade']);
  } finally {
    app.unmount();
  }
});
