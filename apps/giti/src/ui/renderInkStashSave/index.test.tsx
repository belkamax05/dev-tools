import { afterEach, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';

import makeRepo from '../../core/testRepo';
import { type StashSaveChoice, StashSaveForm } from '.';

let repo: ReturnType<typeof makeRepo>;
afterEach(() => repo?.cleanup());

const until = async (ready: () => boolean, what: string) => {
  const deadline = Date.now() + 4000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(20);
  }
};

test('Space takes a file out of the stash without unstaging it, and Enter saves only the ticked ones', async () => {
  repo = makeRepo();
  repo.write('a.txt', 'staged change\n');
  repo.sh(['add', 'a.txt']);
  repo.write('b-new.txt', 'untracked\n');
  repo.write('c-new.txt', 'also untracked\n');
  const gitState = () => [repo.sh(['status', '--porcelain']), repo.sh(['diff', '--cached'])];
  const before = gitState();

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
  let choice: StashSaveChoice | undefined;
  const app = render(
    <StashSaveForm
      cwd={repo.root}
      remote="origin"
      onSave={(picked) => {
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
    await until(() => output.includes('Stash 3 of 3'), 'every file ticked');
    await until(() => output.includes('staged — arrives staged'), 'the first file’s diff');

    //? The cursor starts on a.txt, the staged one: Space takes it out of the stash
    stdin.write(' ');
    await until(() => output.includes('Stash 2 of 3'), 'a.txt left out');
    expect(output).toContain('Left out');
    expect(gitState()).toEqual(before);

    stdin.write('\t');
    await Bun.sleep(50);
    stdin.write('me/part');
    await until(() => output.includes('me/part'), 'the name typed');
    stdin.write('\r');
    await until(() => Boolean(choice), 'the form to save');
    expect(choice).toEqual({ name: 'me/part', force: false, paths: ['b-new.txt', 'c-new.txt'] });
    expect(gitState()).toEqual(before);
  } finally {
    app.unmount();
  }
});
