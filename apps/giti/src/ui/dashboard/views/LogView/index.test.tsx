import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import Box from '@/dev-tools/ui/components/Box';
import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';
import gitExecSync from '../../../../utils/gitExecSync';
import LogView from '.';

const until = async (ready: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for Log scroll');
    await Bun.sleep(20);
  }
};

test('both Log panes use shared scrollbars and the full summary and diff remain reachable', async () => {
  const root = mkdtempSync(join(import.meta.dir, '.log-test-'));
  const git = (...args: string[]) => {
    const result = gitExecSync(args, root);
    if (result.exitCode) throw new Error(result.stderr);
  };
  git('init', '-q');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  for (let i = 0; i < 30; i++) git('commit', '--allow-empty', '-qm', `marker-${i}`);
  for (let i = 0; i < 70; i++) {
    writeFileSync(join(root, `file-${String(i).padStart(2, '0')}.txt`), `payload-${i}\n`);
  }
  git('add', '.');
  git('commit', '-qm', `Latest commit\n\n${Array.from({ length: 60 }, (_, i) => `body-${i}`).join('\n')}`);
  const stdout = Object.assign(new PassThrough(), { columns: 140, rows: 40, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true, setRawMode: () => {}, ref: () => {}, unref: () => {},
  });
  let output = '';
  stdout.on('data', (chunk) => { output = Bun.stripANSI(chunk.toString()); });
  const app = render(
    <Box height={32} width={136} flexDirection="column">
      <LogView root={root} refreshKey={0} reload={() => {}} notify={() => {}}
        onCaptureInput={() => {}} handoff={() => {}} offerUndo={() => {}} reservedChrome={[]} />
    </Box>,
    { stdout: stdout as unknown as NodeJS.WriteStream, stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true, patchConsole: false, onRender: emitFrame },
  );
  const reporting = isMouseReporting();
  try {
    await until(() => output.includes('body-0') && output.split('┃').length > 2);
    expect(output).not.toContain('more rows');
    stdin.write('\u001b[F');
    await until(() => output.includes('70 files changed'));
    stdin.write('\u001b[H');
    await until(() => output.includes('body-0'));
    stdin.write('v');
    await until(() => output.includes('diff --git'));
    expect(output).not.toContain('scroll diff\n');
    stdin.write('\u001b[F');
    await until(() => output.includes('+payload-69'));
    setMouseReporting(true);
    const lines = output.split('\n');
    const row = lines.findIndex((line) => line.includes('┃') && line.indexOf('┃') < 65);
    expect(row).toBeGreaterThanOrEqual(0);
    const column = lines[row]!.indexOf('┃') + 1;
    for (const type of ['press', 'move', 'release'] as const) {
      emitMouseEvent({ type, button: 'left', column, row: type === 'press' ? row + 1 : 30,
        shift: false, alt: false, ctrl: false });
    }
    await until(() => output.includes('marker-0'));
  } finally {
    app.unmount(); app.cleanup(); setMouseReporting(reporting);
    rmSync(root, { recursive: true, force: true });
  }
});
