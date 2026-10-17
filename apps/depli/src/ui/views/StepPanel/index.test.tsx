import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { type DOMElement, Box, measureElement, render, Text } from 'ink';
import { createRef } from 'react';

import StepPanel from '.';

test('scrolling reaches the last row without moving the panel or footer', async () => {
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
  const panel = createRef<DOMElement>();
  const footer = createRef<DOMElement>();
  const app = render(
    <Box height={12} width={40} flexDirection="column">
      <Box ref={panel} flexGrow={1} flexDirection="column" borderStyle="round">
        <Text>Step</Text>
        <StepPanel isActive>
          <Box flexDirection="column" flexShrink={0}>
            {Array.from({ length: 30 }, (_, row) => (
              <Text key={row}>ROW-{row}</Text>
            ))}
          </Box>
        </StepPanel>
      </Box>
      <Box ref={footer} flexShrink={0}>
        <Text>FOOTER</Text>
      </Box>
    </Box>,
    {
      stdout: stdout as unknown as typeof process.stdout,
      stdin: stdin as unknown as typeof process.stdin,
      stderr: stdout as unknown as typeof process.stderr,
      debug: true,
      exitOnCtrlC: false,
    },
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  try {
    await settle();
    const bounds = () => ({
      panel: measureElement(panel.current!),
      footer: measureElement(footer.current!),
    });
    const original = bounds();
    for (const key of ['j', 'j', ' ', 'k', 'G', 'g', 'G']) {
      output = '';
      stdin.write(key);
      await settle();
      expect(bounds()).toEqual(original);
    }
    expect(Bun.stripANSI(output)).toContain('ROW-29');
    expect(original.panel.height).toBe(11);
  } finally {
    app.unmount();
  }
});

test('the scrollbar drags outside its track, consumes the release and supports track clicks', async () => {
  const { emitMouseEvent, isMouseReporting, setMouseReporting } = await import(
    '@/dev-tools/ui/terminal/mouse'
  );
  const { default: ActionButton } = await import('@/dev-tools/ui/components/ActionButton');
  const stdout = Object.assign(new PassThrough(), { columns: 50, rows: 20, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let output = '';
  let clicks = 0;
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const app = render(
    <Box height={8} width={40}>
      <StepPanel isActive>
        <Box flexDirection="column" flexShrink={0}>
          {Array.from({ length: 29 }, (_, row) => (
            <Text key={row}>ROW-{row}</Text>
          ))}
          <ActionButton
            label="LAST-ACTION"
            onPress={() => {
              clicks++;
            }}
          />
        </Box>
      </StepPanel>
    </Box>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
    },
  );
  const reporting = isMouseReporting();
  const event = (type: 'press' | 'move' | 'release', column: number, row: number) =>
    emitMouseEvent({ type, button: 'left', column, row, ctrl: false, alt: false, shift: false });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  try {
    setMouseReporting(true);
    await settle();
    output = '';
    event('press', 40, 2);
    await settle();
    expect(Bun.stripANSI(output)).not.toContain('LAST-ACTION');
    event('move', 5, 20);
    await settle();
    expect(Bun.stripANSI(output)).toContain('LAST-ACTION');
    event('release', 3, 8);
    await settle();
    expect(clicks).toBe(0);
    event('release', 3, 8);
    await settle();
    expect(clicks).toBe(1);
    output = '';
    event('press', 40, 1);
    event('release', 40, 1);
    await settle();
    expect(Bun.stripANSI(output)).toContain('ROW-0');
  } finally {
    setMouseReporting(reporting);
    app.unmount();
  }
});
