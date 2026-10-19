import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';
import { useState } from 'react';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import gitExecSync from '../../../../utils/gitExecSync';
import fileComparison from '../../../../core/fileComparison';
import { getChanges } from '../../../../core/status';
import StatusView from '.';

const until = async (ready: () => boolean) => {
  const deadline = Date.now() + 4000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for status preview');
    await Bun.sleep(20);
  }
};

test('both panes have draggable scrollbars, full diffs scroll and Space still stages the selected file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'giti-scroll-test-'));
  const git = (...args: string[]) => {
    const result = gitExecSync(args, root);
    if (result.exitCode) throw new Error(result.stderr);
    return result.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(
    join(root, 'a-long.txt'),
    Array.from({ length: 80 }, (_, i) => `old-line-${i}`).join('\n') + '\n',
  );
  for (let i = 0; i < 50; i++)
    writeFileSync(join(root, `file-${String(i).padStart(2, '0')}.txt`), 'old\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  writeFileSync(
    join(root, 'a-long.txt'),
    Array.from({ length: 80 }, (_, i) => `new-line-${i}`).join('\n') + '\n',
  );
  for (let i = 0; i < 50; i++)
    writeFileSync(join(root, `file-${String(i).padStart(2, '0')}.txt`), 'new\n');
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
  const Harness = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    return (
      <StatusView
        root={root}
        refreshKey={refreshKey}
        reload={() => setRefreshKey((key) => key + 1)}
        notify={() => {}}
        onCaptureInput={() => {}}
        handoff={() => {}}
        offerUndo={() => {}}
        reservedChrome={[]}
        stagingOnly
      />
    );
  };
  const app = render(<Harness />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    onRender: emitFrame,
  });
  const reporting = isMouseReporting();
  const drag = async (column: number, row: number) => {
    for (const type of ['press', 'move', 'release'] as const) {
      emitMouseEvent({
        type,
        button: 'left',
        column,
        row: type === 'press' ? row : 32,
        ctrl: false,
        alt: false,
        shift: false,
      });
      await Bun.sleep(50);
    }
  };
  try {
    await until(() => output.includes('old-line-0'));
    expect(output).not.toContain('new-line-79');
    expect(output).not.toContain('more rows');
    await Bun.sleep(80);
    stdin.write('\u001b[F');
    await until(() => output.includes('new-line-79'));
    stdin.write('\u001b[H');
    await until(() => output.includes('old-line-0'));
    setMouseReporting(true);
    let lines = output.split('\n');
    let row = lines.findIndex((line) => line.includes('┃') && line.lastIndexOf('┃') > 65);
    expect(row).toBeGreaterThanOrEqual(0);
    await drag(lines[row]!.lastIndexOf('┃') + 1, row + 1);
    await until(() => output.includes('new-line-79'));
    lines = output.split('\n');
    row = lines.findIndex((line) => line.includes('┃') && line.indexOf('┃') < 65);
    expect(row).toBeGreaterThanOrEqual(0);
    await drag(lines[row]!.indexOf('┃') + 1, row + 1);
    await until(() => output.includes('file-49.txt'));
    expect(git('diff', '--cached', '--name-only')).toBe('');
    stdin.write('v');
    await until(
      () =>
        output.includes('old-line-0') &&
        output.includes('new-line-0') &&
        output.includes('Working copy'),
    );
    await Bun.sleep(80);
    stdin.write('\u001b[F');
    await until(() => output.includes('new-line-79'));
    expect(output).toContain('old-line-79');
    stdin.write('s');
    await Bun.sleep(80);
    stdin.write('\u001b[H');
    await until(() => output.includes('new-line-0'));
    expect(output).toContain('old-line-79');
    stdin.write('\t');
    await Bun.sleep(80);
    stdin.write('\u001b[F');
    await until(() => output.includes('old-line-79'));
    expect(output).toContain('new-line-0');
    stdin.write('s');
    await until(() => output.includes('new-line-79'));
    stdin.write('\u001b');
    await until(() => output.includes('Status (51)'));
    await Bun.sleep(80);
    stdin.write(' ');
    await until(() => git('diff', '--cached', '--name-only') === 'a-long.txt');
    expect(git('diff', '--cached')).toContain('new-line-79');
    writeFileSync(join(root, 'a-long.txt'), 'another-working-edit\n');
    const change = (await getChanges(root)).find((entry) => entry.path === 'a-long.txt')!;
    const staged = await fileComparison(root, change, 'staged');
    const unstaged = await fileComparison(root, change, 'unstaged');
    expect(staged.before).toContain('old-line-79');
    expect(staged.after).toContain('new-line-79');
    expect(unstaged.before).toContain('new-line-79');
    expect(unstaged.after).toBe('another-working-edit\n');
  } finally {
    setMouseReporting(reporting);
    app.unmount();
    await Bun.sleep(100);
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Ink's own chalk — the copy that colours its `Text` — reached through Ink rather than imported
 * by name: it is Ink's dependency, not giti's.
 */
const inkChalk = async () =>
  (await import(Bun.resolveSync('chalk', dirname(Bun.resolveSync('ink', import.meta.dir)))))
    .default as { level: number };

/** A repo with a.txt, b.txt and c.txt changed — `staged` of them already in the index. */
const statusFixture = (staged: string[] = []) => {
  const root = mkdtempSync(join(tmpdir(), 'giti-status-cursor-test-'));
  const git = (...args: string[]) => {
    const result = gitExecSync(args, root);
    if (result.exitCode) throw new Error(result.stderr);
    return result.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  for (const name of ['a', 'b', 'c']) writeFileSync(join(root, `${name}.txt`), 'old\n');
  git('add', '.');
  git('commit', '-qm', 'initial');
  for (const name of ['a', 'b', 'c']) writeFileSync(join(root, `${name}.txt`), 'new\n');
  if (staged.length) git('add', ...staged);

  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 24, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const frame = { raw: '', text: '' };
  stdout.on('data', (chunk) => {
    frame.raw = chunk.toString();
    frame.text = Bun.stripANSI(frame.raw);
  });
  const Harness = () => {
    const [refreshKey, setRefreshKey] = useState(0);
    return (
      <StatusView
        root={root}
        refreshKey={refreshKey}
        reload={() => setRefreshKey((key) => key + 1)}
        notify={() => {}}
        onCaptureInput={() => {}}
        handoff={() => {}}
        offerUndo={() => {}}
        reservedChrome={[]}
        stagingOnly
      />
    );
  };
  const app = render(<Harness />, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
  });
  /** The list row under the cursor, as text. */
  const cursorRow = () =>
    frame.text.split('\n').find((line) => line.includes('❯'))?.split('││')[0] ?? '';
  /** The raw (coloured) list row of `file` in the group headed `group`. */
  const rawRow = (file: string) =>
    frame.raw.split('\n').find((line) => Bun.stripANSI(line).includes(file)) ?? '';
  return {
    frame,
    stdin,
    cursorRow,
    rawRow,
    git,
    dispose: () => {
      app.unmount();
      rmSync(root, { recursive: true, force: true });
    },
  };
};

test('Space walks down the changes: the cursor takes the next file in the group, never a header', async () => {
  const status = statusFixture();
  try {
    await until(() => status.cursorRow().includes('a.txt'));
    status.stdin.write(' ');
    await until(() => status.frame.text.includes('STAGED (1)') && status.cursorRow().includes('b.txt'));
    status.stdin.write(' ');
    await until(() => status.frame.text.includes('STAGED (2)') && status.cursorRow().includes('c.txt'));
    status.stdin.write(' ');
    await until(() => status.frame.text.includes('STAGED (3)'));
    await Bun.sleep(100);
    //? Changes is empty now and its header gone: the cursor is on a file, the closest one
    expect(status.cursorRow()).toMatch(/[abc]\.txt/);
    expect(status.cursorRow()).not.toMatch(/STAGED|CHANGES/);
  } finally {
    status.dispose();
  }
});

test('unstaging the last staged file selects the one before it, and the moved file flashes', async () => {
  //? A pipe is no colour terminal, so colours are off unless asked for — and they are the point here
  const chalk = await inkChalk();
  const level = chalk.level;
  chalk.level = 3;
  const status = statusFixture(['a.txt', 'b.txt', 'c.txt']);
  try {
    await until(() => status.cursorRow().includes('a.txt'));
    status.stdin.write('\u001b[B');
    await until(() => status.cursorRow().includes('b.txt'));
    status.stdin.write('\u001b[B');
    await until(() => status.cursorRow().includes('c.txt'));
    status.stdin.write(' ');
    await until(() => status.frame.text.includes('CHANGES (1)') && status.cursorRow().includes('b.txt'));
    expect(status.git('diff', '--cached', '--name-only').trim().split('\n')).toEqual(['a.txt', 'b.txt']);

    //? c.txt, now under Changes, is drawn in another colour for a moment — then like the rest
    const flashing = status.rawRow('c.txt');
    await Bun.sleep(2300);
    await until(() => status.rawRow('c.txt') !== flashing);
    expect(Bun.stripANSI(status.rawRow('c.txt'))).toBe(Bun.stripANSI(flashing));
  } finally {
    status.dispose();
    chalk.level = level;
  }
  //? It waits out the two-second flash
}, 10_000);
