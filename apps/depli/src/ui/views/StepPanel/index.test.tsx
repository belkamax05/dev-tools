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
