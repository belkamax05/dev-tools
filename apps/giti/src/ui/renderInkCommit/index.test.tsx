import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import gitExecSync from '../../utils/gitExecSync';
import { CommitForm } from '.';

const until = async (ready: () => boolean) => {
  const deadline = Date.now() + 4000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for commit form');
    await Bun.sleep(20);
  }
};

for (const scenario of ['ready', 'missing', 'cancel', 'amend'] as const) {
  test(`Shift+Enter handles ${scenario} messages without optional review steps`, async () => {
    const root = mkdtempSync(join(import.meta.dir, '.commit-test-'));
    const git = (...args: string[]) => {
      const result = gitExecSync(args, root);
      if (result.exitCode) throw new Error(result.stderr);
    };
    git('init', '-q');
    writeFileSync(join(root, 'file.txt'), 'staged\n');
    git('add', 'file.txt');
    const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 36, isTTY: true });
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
    let selection: string[] | undefined;
    const app = render(
      <CommitForm
        cwd={root}
        initialMessage={scenario === 'ready' ? 'Ready to commit' : undefined}
        initialFlags={scenario === 'amend' ? ['--amend'] : []}
        passthroughFlags={[]}
        onCommit={(args) => {
          selection = args;
        }}
      />,
      {
        stdout: stdout as unknown as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        debug: true,
        patchConsole: false,
      },
    );
    try {
      await until(() => output.includes('file.txt'));
      stdin.write('\u001b[13;2u');
      if (scenario === 'ready' || scenario === 'amend') {
        await until(() => Boolean(selection));
        expect(selection).toEqual(
          scenario === 'amend'
            ? ['commit', '--amend', '--no-edit']
            : ['commit', '-m', 'Ready to commit'],
        );
      } else {
        await until(() => output.includes('Commit message') && !output.includes('Flags'));
        expect(selection).toBeUndefined();
        stdin.write('\r');
        await until(() => output.includes('Enter a commit message.'));
        expect(selection).toBeUndefined();
        if (scenario === 'cancel') {
          stdin.write('\u001b');
          await until(() => output.includes('Flags'));
          expect(selection).toBeUndefined();
        } else {
          stdin.write('Quick commit');
          await until(() => output.includes('Quick commit'));
          stdin.write('\r');
          await until(() => Boolean(selection));
          expect(selection).toEqual(['commit', '-m', 'Quick commit']);
        }
      }
    } finally {
      app.unmount();
      app.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  });
}
