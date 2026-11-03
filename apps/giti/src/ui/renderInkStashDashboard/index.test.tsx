import { afterEach, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';

import { getRemoteStashes } from '../../core/remoteStash';
import makeRepo from '../../core/testRepo';
import { StashDashboard } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const until = async (ready: () => boolean, what: string, frame: () => string) => {
  const deadline = Date.now() + 6000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}:\n${frame()}`);
    await Bun.sleep(20);
  }
};

test('saves a new stash, applies it and removes it, all from the one screen', async () => {
  repo = makeRepo({ remote: true });
  repo.write('a.txt', 'shared change\n');

  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 36, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  stdout.on('data', (chunk) => {
    output = Bun.stripANSI(chunk.toString());
  });
  const shows = (text: string) => () => output.includes(text);
  const wait = (text: string, what: string) => until(shows(text), what, () => output);
  const app = render(<StashDashboard cwd={repo.root} remote="origin" />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    onRender: emitFrame,
  });
  try {
    await wait('0 stash(es) on origin', 'the empty listing');
    expect(output).toContain('Save new stash');

    //? s: the save screen, over the list — name it and Enter pushes it, back on the list
    stdin.write('s');
    await wait('Stash 1 of 1', 'the save screen');
    stdin.write('\t');
    await Bun.sleep(50);
    stdin.write('me/wip');
    await wait('me/wip', 'the name');
    stdin.write('\r');
    await wait('Saved stash me/wip to origin', 'the save to finish');
    await wait('Stashes on origin (1)', 'the new stash listed');
    expect(output).toContain('[x] Remove');

    //? Saving left the work tree as it was; put a.txt back so the stash has something to bring
    repo.sh(['checkout', '--', 'a.txt']);
    //? Enter: its files as a checklist; Enter again applies them, and the list comes back
    stdin.write('\r');
    await wait('Apply 1 of 1', 'the files step');
    stdin.write('\r');
    await wait('Applied stash me/wip', 'the apply’s outcome in the status line');
    await wait('Stashes on origin (1)', 'the list again');
    expect(repo.read('a.txt')).toBe('shared change\n');

    //? x asks in place; y removes it from the remote
    stdin.write('x');
    await wait('Remove me/wip from origin for everyone?', 'the question');
    stdin.write('y');
    await wait('Removed stash me/wip from origin', 'the removal');
    await wait('Stashes on origin (0)', 'the empty list again');
    expect(await getRemoteStashes(repo.root, 'origin')).toEqual([]);
  } finally {
    app.unmount();
  }
});
