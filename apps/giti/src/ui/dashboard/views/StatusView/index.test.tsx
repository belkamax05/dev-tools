import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const root = mkdtempSync(join(import.meta.dir, '.scroll-test-'));
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
