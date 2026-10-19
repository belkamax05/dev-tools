import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render, Text, useInput } from 'ink';

import createFilteredStdin, { normalizeInterrupt } from '.';

test('Ctrl+C in the kitty keyboard protocol becomes the ^C byte, with a lock key on too', () => {
  expect(normalizeInterrupt('\u001b[99;5u')).toBe('\u0003');
  expect(normalizeInterrupt('\u001b[99;5:1u')).toBe('\u0003');
  //? Caps Lock (64) on: still Ctrl alone
  expect(normalizeInterrupt('\u001b[99;69u')).toBe('\u0003');
});

test('Ctrl+Shift+C, a release and other Ctrl keys are left as they are', () => {
  expect(normalizeInterrupt('\u001b[99;6u')).toBe('\u001b[99;6u');
  expect(normalizeInterrupt('\u001b[99;5:3u')).toBe('\u001b[99;5:3u');
  expect(normalizeInterrupt('\u001b[97;5u')).toBe('\u001b[97;5u');
});

//? Ink reads stdin only while something listens to it — as every view of a real app does
const Listening = () => {
  useInput(() => {});
  return <Text>running</Text>;
};

test('an Ink app with the kitty protocol on quits on Ctrl+C, and the stop is reported', async () => {
  const source = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  }) as unknown as NodeJS.ReadStream;
  const filtered = createFilteredStdin(source);
  const stdout = Object.assign(new PassThrough(), { columns: 40, rows: 5, isTTY: true });
  let exited = false;
  const app = render(<Listening />, {
    stdin: filtered.stdin,
    stdout: stdout as unknown as NodeJS.WriteStream,
    debug: true,
    patchConsole: false,
    exitOnCtrlC: true,
    kittyKeyboard: { mode: 'enabled', flags: ['disambiguateEscapeCodes'] },
  });
  void app.waitUntilExit().then(() => {
    exited = true;
  });
  try {
    await Bun.sleep(100);
    expect(filtered.wasInterrupted()).toBe(false);
    (source as unknown as PassThrough).write('\u001b[99;5u');
    const deadline = Date.now() + 2000;
    while (!exited && Date.now() < deadline) await Bun.sleep(20);
    expect(exited).toBe(true);
    expect(filtered.wasInterrupted()).toBe(true);
  } finally {
    app.unmount();
    filtered.dispose();
  }
});
