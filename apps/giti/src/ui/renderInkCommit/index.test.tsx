import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

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
        expect(output).toContain('Commit message required');
        //? Re-renders must not wipe it: `TextInput` replays `onChange` on each one
        await Bun.sleep(200);
        expect(output).toContain('Enter a commit message.');
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

const mountForm = (rows = 36) => {
  const root = mkdtempSync(join(import.meta.dir, '.commit-test-'));
  const git = (...args: string[]) => {
    const result = gitExecSync(args, root);
    if (result.exitCode) throw new Error(result.stderr);
  };
  git('init', '-q');
  writeFileSync(join(root, 'file.txt'), 'staged\n');
  git('add', 'file.txt');
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const frame = { output: '' };
  stdout.on('data', (chunk) => {
    frame.output = Bun.stripANSI(chunk.toString());
  });
  let exited = false;
  const app = render(
    <CommitForm cwd={root} initialFlags={[]} passthroughFlags={[]} onCommit={() => {}} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
    },
  );
  void app.waitUntilExit().then(() => {
    exited = true;
  });
  return {
    frame,
    stdin,
    hasExited: () => exited,
    dispose: () => {
      app.unmount();
      app.cleanup();
      rmSync(root, { recursive: true, force: true });
    },
  };
};

test('the form fills the terminal, with the message and flags pinned to its bottom', async () => {
  const form = mountForm(40);
  try {
    await until(() => form.frame.output.includes('file.txt'));
    const lines = form.frame.output.replace(/\n$/, '').split('\n');
    //? One row is held back from Ink, as under `AppShell`
    expect(lines).toHaveLength(39);
    expect(lines.at(-1)).toContain('Space stage/unstage');
  } finally {
    form.dispose();
  }
});

test('q quits from the file list, but is typed into the commit message', async () => {
  const typing = mountForm();
  try {
    await until(() => typing.frame.output.includes('file.txt'));
    typing.stdin.write('\t');
    await until(() => typing.frame.output.includes('Focus: message'));
    typing.stdin.write('q');
    await until(() => typing.frame.output.includes('Commit message') && /│\s*q/.test(typing.frame.output));
    expect(typing.hasExited()).toBe(false);
  } finally {
    typing.dispose();
  }

  const browsing = mountForm();
  try {
    await until(() => browsing.frame.output.includes('file.txt'));
    browsing.stdin.write('q');
    await until(browsing.hasExited);
  } finally {
    browsing.dispose();
  }
});

test('Enter walks an empty message into focus, and only flags it once there', async () => {
  const form = mountForm();
  try {
    await until(() => form.frame.output.includes('file.txt'));
    form.stdin.write('\r');
    await until(() => form.frame.output.includes('Focus: message'));
    expect(form.frame.output).not.toContain('Commit message required');
    expect(form.frame.output).not.toContain('Enter a commit message.');
    form.stdin.write('\r');
    await until(() => form.frame.output.includes('Commit message required'));
    expect(form.frame.output).toContain('Enter a commit message.');
  } finally {
    form.dispose();
  }
});

test('the message sits right under its title, and a click on it puts the cursor there', async () => {
  const form = mountForm();
  const reporting = isMouseReporting();
  try {
    await until(() => form.frame.output.includes('file.txt'));
    const lines = form.frame.output.split('\n');
    const title = lines.findIndex((line) => line.includes('Commit message') && !line.includes('…'));
    expect(lines[title + 1]).toContain('Commit message…');
    //? Tab steps from panel to panel; a button naming it as the way into the message misled
    expect(form.frame.output).not.toContain('Edit message');

    setMouseReporting(true);
    const row = title + 1;
    emitMouseEvent({
      type: 'release',
      button: 'left',
      row: row + 1,
      column: (lines[row] ?? '').indexOf('Commit message…') + 2,
      ctrl: false,
      alt: false,
      shift: false,
    });
    await until(() => form.frame.output.includes('Focus: message'));
    //? Focused, `q` is a letter of the message rather than quit
    form.stdin.write('q');
    await until(() => /│\s*q/.test(form.frame.output));
    expect(form.hasExited()).toBe(false);
  } finally {
    setMouseReporting(reporting);
    form.dispose();
  }
});
