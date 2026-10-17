import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { type DOMElement, Box, measureElement, render } from 'ink';
import { createRef } from 'react';

import type { StepRun } from '../../../core/plugin';
import OtherRuns from '.';

test('other-branch activity stays visible while idle locally, then disappears when it finishes', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 30, isTTY: true });
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const run: StepRun = { id: '42', label: '#42', branch: 'feature/another', state: 'running' };
  let reads = 0;
  const root = createRef<DOMElement>();
  const app = render(
    <Box ref={root} flexDirection="column" width={70}>
      <OtherRuns
        initial={[run]}
        scope="build:ci"
        expanded={{}}
        onExpandedChange={() => {}}
        isActive={false}
        read={async () => (++reads === 1 ? [run] : [])}
        readTimings={async () => ({
          more: true,
          state: 'running',
          elapsedMs: 3000,
          estimatedTotalMs: 12000,
          stages: [],
          previousRuns: ['41'],
        })}
      />
    </Box>,
    { stdout: stdout as unknown as NodeJS.WriteStream, debug: true, patchConsole: false },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = Bun.stripANSI(output);
    expect(text).toContain('Other branches running');
    expect(text).toContain('feature/another');
    expect(text).toContain('Build · #42 · Running');
    expect(text).toContain('~9s left');
    output = '';
    await new Promise((resolve) => setTimeout(resolve, 5100));
    expect(reads).toBe(2);
    expect(measureElement(root.current!).height).toBe(0);
  } finally {
    app.unmount();
  }
}, 10000);
