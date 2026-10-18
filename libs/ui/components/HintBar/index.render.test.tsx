import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '../../terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '../../terminal/mouse';
import HintBar from '.';

test('wrapped controls stay visible and clickable on their own rows', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 30, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  let pressed = '';
  stdout.on('data', (chunk) => {
    output = Bun.stripANSI(chunk.toString());
  });
  const reporting = isMouseReporting();
  setMouseReporting(true);
  const app = render(
    <HintBar
      width={36}
      maxRows={10}
      hints={Array.from({ length: 8 }, (_, i) => ({
        key: String(i),
        label: `action-${i}`,
        onPress: () => {
          pressed = String(i);
        },
      }))}
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
    await Bun.sleep(100);
    expect(output).not.toContain('…');
    for (let i = 0; i < 8; i++) expect(output).toContain(`action-${i}`);
    const lines = output.split('\n');
    const row = lines.findIndex((line) => line.includes('action-7'));
    expect(row).toBeGreaterThan(0);
    const column = lines[row]!.indexOf('action-7') + 1;
    for (const type of ['press', 'release'] as const) {
      emitMouseEvent({
        type,
        button: 'left',
        column,
        row: row + 1,
        shift: false,
        alt: false,
        ctrl: false,
      });
    }
    await Bun.sleep(30);
    expect(pressed).toBe('7');
  } finally {
    app.unmount();
    app.cleanup();
    setMouseReporting(reporting);
  }
});
