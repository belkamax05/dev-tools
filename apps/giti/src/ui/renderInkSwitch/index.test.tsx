import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import gitExecSync from '../../utils/gitExecSync';
import { SwitchForm } from '.';

const until = async (ready: () => boolean, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the hop screen');
    await Bun.sleep(20);
  }
};

/**
 * A clone with `main` checked out, a local `fix/typo`, and `release` only on the remote — then
 * the hop screen on it, flags off unless asked for.
 */
const mount = (options: { initialBranch?: string; flags?: Partial<Record<'force' | 'detach' | 'noTrack', boolean>> } = {}) => {
  const base = mkdtempSync(join(tmpdir(), 'giti-hop-test-'));
  const remote = join(base, 'remote.git');
  const root = join(base, 'work');
  const git = (cwd: string, ...args: string[]) => {
    const result = gitExecSync(args, cwd);
    if (result.exitCode) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  git(base, 'init', '-q', '--bare', '-b', 'main', remote);
  git(base, 'clone', '-q', remote, root);
  git(root, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(root, 'push', '-q', '-u', 'origin', 'main');
  git(root, 'switch', '-q', '-c', 'release');
  git(root, 'commit', '-q', '--allow-empty', '-m', 'release work');
  git(root, 'push', '-q', '-u', 'origin', 'release');
  git(root, 'switch', '-q', 'main');
  git(root, 'branch', '-q', '-D', 'release');
  git(root, 'branch', '-q', 'fix/typo');

  const stdout = Object.assign(new PassThrough(), { columns: 110, rows: 32, isTTY: true });
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
  const done: { switched?: string; exited: boolean } = { exited: false };
  const app = render(
    <SwitchForm
      cwd={root}
      initialBranch={options.initialBranch}
      initialFlags={{ force: false, detach: false, noTrack: false, track: false, ...options.flags }}
      passthroughFlags={[]}
      refreshSeconds={0}
      onSwitched={(message) => {
        done.switched = message;
      }}
    />,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
    },
  );
  void app.waitUntilExit().then(() => {
    done.exited = true;
  });
  return {
    root,
    frame,
    stdin,
    done,
    git: (...args: string[]) => git(root, ...args),
    dispose: () => {
      app.unmount();
      app.cleanup();
      rmSync(base, { recursive: true, force: true });
    },
  };
};

/** Search for `text` in the picker, then switch to the first match. */
const pick = async (hop: ReturnType<typeof mount>, text: string) => {
  await until(() => hop.frame.output.includes('origin/release') && hop.frame.output.includes('fetched '));
  hop.stdin.write(`/${text}`);
  await until(() => hop.frame.output.includes(`/${text}`));
  hop.stdin.write('\r');
  await Bun.sleep(100);
  hop.stdin.write('\r');
};

test('a remote branch is switched to as a local one tracking it, and the screen closes', async () => {
  const hop = mount();
  try {
    expect(hop.frame.output).not.toContain('│   origin  ');
    await pick(hop, 'origin/release');
    await until(() => hop.done.exited);
    expect(hop.done.switched).toBe('Switched to release');
    expect(hop.git('branch', '--show-current')).toBe('release');
    expect(hop.git('rev-parse', '--abbrev-ref', 'release@{u}')).toBe('origin/release');
  } finally {
    hop.dispose();
  }
});

test('No tracking, picked in the flags panel, makes the local branch track nothing', async () => {
  const hop = mount();
  try {
    await until(() => hop.frame.output.includes('Focus: branches'));
    hop.stdin.write('\t');
    await until(() => hop.frame.output.includes('Focus: flags'));
    hop.stdin.write('3');
    await until(() => hop.frame.output.includes('(--no-track)'));
    hop.stdin.write('\t');
    await until(() => hop.frame.output.includes('Focus: branches'));
    await pick(hop, 'origin/release');
    await until(() => hop.done.exited);
    expect(hop.git('branch', '--show-current')).toBe('release');
    expect(gitExecSync(['rev-parse', '--abbrev-ref', 'release@{u}'], hop.root).exitCode).not.toBe(0);
  } finally {
    hop.dispose();
  }
});

test('Detach checks out the commit on no branch', async () => {
  const hop = mount({ flags: { detach: true } });
  try {
    await pick(hop, 'fix/typo');
    await until(() => hop.done.exited);
    expect(hop.done.switched).toBe('Switched to fix/typo (detached)');
    expect(hop.git('branch', '--show-current')).toBe('');
  } finally {
    hop.dispose();
  }
});

test('a name that matched no branch outright starts the search, and Esc / q leave without switching', async () => {
  const hop = mount({ initialBranch: 'typo' });
  try {
    await until(() => hop.frame.output.includes('/typo') && hop.frame.output.includes('fix/typo'));
    expect(hop.frame.output).not.toContain('origin/release');
    //? The first Esc clears the search, as on the dashboard; q then closes
    hop.stdin.write('\u001b');
    await until(() => hop.frame.output.includes('origin/release'));
    hop.stdin.write('q');
    await until(() => hop.done.exited);
    expect(hop.done.switched).toBeUndefined();
    expect(hop.git('branch', '--show-current')).toBe('main');
  } finally {
    hop.dispose();
  }
});
