import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { Box, render } from 'ink';

import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import LogPanel from '.';

test('dragging the log scrollbar upward leaves the tail and reveals older lines', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 50, rows: 20, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const app = render(
    <Box width={40} height={8}>
      <LogPanel
        run={{ id: '1', label: '#1', state: 'success' }}
        runKey="1"
        read={async () => ({
          text: Array.from({ length: 40 }, (_, row) => `LINE-${row}`).join('\n') + '\n',
          next: 300,
          more: false,
        })}
        rows={8}
        width={40}
        onOtherRun={() => {}}
        runIndex={0}
        runCount={1}
        isActive
      />
    </Box>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
    },
  );
  const reporting = isMouseReporting();
  const event = (type: 'press' | 'move' | 'release', row: number) =>
    emitMouseEvent({
      type,
      button: 'left',
      column: 40,
      row,
      ctrl: false,
      alt: false,
      shift: false,
    });
  try {
    setMouseReporting(true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Bun.stripANSI(output)).toContain('LINE-39');
    output = '';
    event('press', 8);
    event('move', 2);
    event('release', 2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Bun.stripANSI(output)).toContain('LINE-0');
    expect(Bun.stripANSI(output)).not.toContain('LINE-39');
  } finally {
    setMouseReporting(reporting);
    app.unmount();
  }
});
