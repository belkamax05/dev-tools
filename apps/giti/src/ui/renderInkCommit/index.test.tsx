import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import gitExecSync from '../../utils/gitExecSync';
import { CommitForm } from '.';

const until = async (ready: () => boolean, ms = 4000) => {
  const deadline = Date.now() + ms;
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

const mountForm = (rows = 36, refreshSeconds?: number) => {
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
    <CommitForm
      cwd={root}
      initialFlags={[]}
      passthroughFlags={[]}
      refreshSeconds={refreshSeconds}
      onCommit={() => {}}
    />,
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
    root,
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

test('a file changed outside the open form shows up in its list without a key press', async () => {
  //? The poll interval off: what is on screen came from the watcher
  const form = mountForm(36, 0);
  try {
    await until(() => form.frame.output.includes('file.txt'));
    expect(form.frame.output).not.toContain('later.txt');
    writeFileSync(join(form.root, 'later.txt'), 'new\n');
    await until(() => form.frame.output.includes('later.txt'));
  } finally {
    form.dispose();
  }
});

test('the arrows walk the flags, Space toggles the one under the cursor, and each is explained', async () => {
  const form = mountForm();
  try {
    await until(() => form.frame.output.includes('file.txt'));
    form.stdin.write('\t');
    await until(() => form.frame.output.includes('Focus: message'));
    form.stdin.write('\t');
    await until(() => form.frame.output.includes('Focus: flags'));
    expect(form.frame.output).toContain('Skip hooks (--no-verify): Commit without running');
    form.stdin.write('\u001b[C');
    await until(() => form.frame.output.includes('Amend (--amend): Fold the staged changes'));
    expect(form.frame.output).toContain('▸Amend');
    form.stdin.write(' ');
    await until(() => form.frame.output.includes('Amend (--amend, on)'));
    form.stdin.write('\u001b[D');
    await until(() => form.frame.output.includes('▸Skip hooks'));
    //? Wraps around: left of the first flag is the last
    form.stdin.write('\u001b[D');
    await until(() => form.frame.output.includes('Push after commit (--push): Once the commit succeeds'));
  } finally {
    form.dispose();
  }
});

test('a clean tree says so in the middle, Push is counted and works, and files bring the list back', async () => {
  const base = mkdtempSync(join(import.meta.dir, '.commit-test-'));
  const remote = join(base, 'remote.git');
  const root = join(base, 'work');
  const git = (cwd: string, ...args: string[]) => {
    const result = gitExecSync(args, cwd);
    if (result.exitCode) throw new Error(result.stderr);
  };
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'clone', '-q', remote, root);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'two');
  const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 30, isTTY: true });
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
  const app = render(
    <CommitForm cwd={root} initialFlags={[]} passthroughFlags={[]} refreshSeconds={0} onCommit={() => {}} />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
    },
  );
  try {
    await until(() => output.includes('Nothing to commit — the working tree is clean'));
    expect(output).not.toContain('Status (0)');
    await until(() => output.includes('Push ↑2') && output.includes('↑2'));
    //? The dashboard's keys: P sends the two commits, and the bar says so once they are out —
    //? after the fetch the form starts on its own, which the bar is busy with until then
    await until(() => output.includes('fetched '));
    stdin.write('P');
    await until(() => output.includes('[P] Push') && !output.includes('Push ↑2'), 20_000);
    expect(gitExecSync(['rev-list', '--count', 'main'], remote).stdout.trim()).toBe('3');
    writeFileSync(join(root, 'new.txt'), 'x\n');
    await until(() => output.includes('new.txt'));
    expect(output).not.toContain('Nothing to commit — the working tree is clean');
  } finally {
    app.unmount();
    app.cleanup();
    rmSync(base, { recursive: true, force: true });
  }
  //? A real `giti send` runs in a child process
}, 30_000);
