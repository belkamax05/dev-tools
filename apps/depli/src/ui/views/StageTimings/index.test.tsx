import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { Box, render, renderToString } from 'ink';
import { type ComponentProps, useState } from 'react';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import type { RunTimings } from '../../../core/plugin';
import ScrollPanel from '@/dev-tools/ui/components/ScrollPanel';
import StageTimings from '.';

const TestTimings = (
  props: Omit<ComponentProps<typeof StageTimings>, 'expanded' | 'onExpandedChange'>,
) => {
  const [expanded, setExpanded] = useState(false);
  return <StageTimings {...props} expanded={expanded} onExpandedChange={setExpanded} />;
};

test('timings start compact, expand on click, remain scrollable and collapse with s', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 60, rows: 16, isTTY: true });
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
  const read = async (): Promise<RunTimings> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return {
      more: false,
      elapsedMs: 24000,
      estimatedTotalMs: 12000,
      previousRuns: ['1'],
      stages: Array.from({ length: 12 }, (_, id) => ({
        id: String(id),
        label: `Stage ${id}`,
        state: 'success' as const,
        durationMs: 2000,
        averageMs: 1000,
        samples: 1,
      })),
    };
  };
  const app = render(
    <Box width={50} height={8} flexDirection="column">
      <ScrollPanel isActive>
        <TestTimings
          run={{ id: '2', label: '#2', state: 'success' }}
          runKey="build:2"
          read={read}
        />
      </ScrollPanel>
    </Box>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      stderr: stdout as unknown as NodeJS.WriteStream,
      debug: true,
      exitOnCtrlC: false,
      onRender: emitFrame,
    },
  );
  const reporting = isMouseReporting();
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(Bun.stripANSI(output)).toContain('Total 24s');
    expect(Bun.stripANSI(output)).toContain('Timings · #2 · Complete');
    expect(Bun.stripANSI(output)).toContain('avg total ~12s');
    expect(Bun.stripANSI(output)).not.toContain('Stage 11');
    setMouseReporting(true);
    emitMouseEvent({
      type: 'release',
      button: 'left',
      column: 5,
      row: 2,
      ctrl: false,
      alt: false,
      shift: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    output = '';
    stdin.write('G');
    await new Promise((resolve) => setTimeout(resolve, 100));
    const text = Bun.stripANSI(output);
    expect(text).toContain('Stage 11');
    expect(text).toContain('200% of avg');
    expect(text).toContain('live logs');
    output = '';
    stdin.write('s');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Bun.stripANSI(output)).toContain('▸ Timings');
    expect(Bun.stripANSI(output)).not.toContain('Stage 11');
  } finally {
    setMouseReporting(reporting);
    app.unmount();
  }
});

test('live stage polling stops after Jenkins reports the build finished', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 60, rows: 16, isTTY: true });
  stdout.on('data', () => {});
  let reads = 0;
  const app = render(
    <TestTimings
      run={{ id: '3', label: '#3', state: 'running' }}
      runKey="build:3"
      isActive={false}
      read={async () => ({ more: ++reads === 1, previousRuns: [], stages: [] })}
    />,
    { stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false },
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 3200));
    expect(reads).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(reads).toBe(2);
  } finally {
    app.unmount();
  }
}, 10000);

test('a restored expanded preference stays expanded after navigating to another run', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 60, rows: 30, isTTY: true });
  let output = '';
  stdout.on('data', (chunk) => {
    output += chunk;
  });
  const view = (id: string) => (
    <StageTimings
      key={id}
      isActive={false}
      expanded
      onExpandedChange={() => {}}
      run={{ id, label: `#${id}`, state: 'success' }}
      runKey={`build:${id}`}
      read={async () => ({
        more: false,
        previousRuns: [],
        stages: [
          { id: 'stage', label: `Build for ${id}`, state: 'success', durationMs: 2000, samples: 0 },
        ],
      })}
    />
  );
  const app = render(view('1'), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(Bun.stripANSI(output)).toContain('Build for 1');
    output = '';
    app.rerender(view('2'));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(Bun.stripANSI(output)).toContain('Build for 2');
    expect(Bun.stripANSI(output)).toContain('▾ Timings');
  } finally {
    app.unmount();
  }
});

test('a completed stale build keeps its completion status and labels freshness beside its number', () => {
  const output = renderToString(
    <StageTimings
      stale
      expanded={false}
      onExpandedChange={() => {}}
      run={{ id: '42', label: '#42', state: 'success' }}
      runKey="build:42"
      read={async () => ({ more: false, stages: [], previousRuns: [] })}
    />,
  );
  expect(output).toContain('#42 · Stale · Complete');
});

test('a running build is labelled Running rather than Stale', () => {
  const output = renderToString(
    <StageTimings
      stale
      expanded={false}
      onExpandedChange={() => {}}
      run={{ id: '43', label: '#43', state: 'running' }}
      runKey="build:43"
      read={async () => ({ more: true, stages: [], previousRuns: [] })}
    />,
  );
  expect(output).toContain('#43 · Running');
  expect(output).not.toContain('Stale');
});
