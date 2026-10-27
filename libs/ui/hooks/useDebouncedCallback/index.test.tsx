import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';

import useDebouncedCallback, { type DebouncedCallback } from '.';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const mount = (onSettle: (value: string) => void) => {
  const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 10, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  let debounced: DebouncedCallback<[string]> | undefined;
  const Probe = () => {
    debounced = useDebouncedCallback(onSettle, 30);
    return <Text>probe</Text>;
  };
  const app = render(<Probe />, {
    stdout: stdout as unknown as typeof process.stdout,
    stdin: stdin as unknown as typeof process.stdin,
    stderr: stdout as unknown as typeof process.stderr,
    debug: true,
    exitOnCtrlC: false,
  });
  return { app, call: () => debounced as DebouncedCallback<[string]> };
};

test('typing runs the callback once, with the last value, after the pause', async () => {
  const seen: string[] = [];
  const { app, call } = mount((value) => seen.push(value));
  call()('r');
  call()('re');
  call()('rea');
  expect(seen).toEqual([]);
  await wait(60);
  expect(seen).toEqual(['rea']);
  app.unmount();
});

test('cancel and unmount drop a call still waiting', async () => {
  const seen: string[] = [];
  const { app, call } = mount((value) => seen.push(value));
  call()('a');
  call().cancel();
  await wait(60);
  call()('b');
  app.unmount();
  await wait(60);
  expect(seen).toEqual([]);
});
