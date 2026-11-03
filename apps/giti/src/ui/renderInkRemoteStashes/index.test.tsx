import { afterEach, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';

import { saveRemoteStash } from '../../core/remoteStash';
import makeRepo from '../../core/testRepo';
import { type RemoteStashChoice, RemoteStashPicker } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const until = async (ready: () => boolean, what: string) => {
  const deadline = Date.now() + 4000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

test('Enter on a stash opens its files; untick one and Enter applies only the rest', async () => {
  repo = makeRepo({ remote: true });
  repo.write('a.txt', 'shared change\n');
  repo.write('new.txt', 'new\n');
  expect((await saveRemoteStash(repo.root, 'origin', 'me/wip')).ok).toBe(true);

  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 32, isTTY: true });
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
  let choice: RemoteStashChoice | undefined;
  const app = render(
    <RemoteStashPicker
      cwd={repo.root}
      remote="origin"
      mode="apply"
      onPick={(picked) => {
        choice = picked;
      }}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
      onRender: emitFrame,
    },
  );
  try {
    await until(() => output.includes('1 stash(es) on origin'), 'the listing');
    await until(() => output.includes('2 file(s)'), 'the stash’s files');
    expect(output).toContain('me/wip');
    expect(output).toContain('new.txt');

    stdin.write('\r');
    await until(() => output.includes('Apply 2 of 2'), 'the files step, all ticked');
    await until(() => output.includes('+shared change'), 'a.txt’s diff');
    //? The cursor starts on a.txt: Space leaves it out
    stdin.write(' ');
    await until(() => output.includes('Apply 1 of 2'), 'a.txt left out');

    //? Esc goes back to the stashes; opening it again starts with every file ticked
    stdin.write('\u001b');
    await until(() => output.includes('1 stash(es) on origin'), 'back to the stashes');
    stdin.write('\r');
    await until(() => output.includes('Apply 2 of 2'), 'the files step again');
    stdin.write(' ');
    await until(() => output.includes('Apply 1 of 2'), 'a.txt left out again');

    stdin.write('i');
    await until(() => output.includes('All unstaged'), 'the staged toggle');
    stdin.write('\r');
    await until(() => Boolean(choice), 'the pick');
    expect(choice).toMatchObject({ index: false, paths: ['new.txt'] });
    expect(choice?.stash.name).toBe('me/wip');
  } finally {
    app.unmount();
  }
});
