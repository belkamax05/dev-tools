import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render, Text } from 'ink';

import { emitFrame } from '../../terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '../../terminal/mouse';
import AppShell from '.';

test('the footer names each key once — on its button, where it can be clicked', async () => {
  const stdout = Object.assign(new PassThrough(), { columns: 120, rows: 24, isTTY: true });
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
  const reporting = isMouseReporting();
  setMouseReporting(true);
  const pressed: string[] = [];
  const app = render(
    <AppShell
      title="demo"
      tabs={[
        { id: 'a', icon: '🧩', label: '🧩 A' },
        { id: 'b', icon: '📄', label: '📄 B' },
      ]}
      activeTab="a"
      onTabChange={() => {}}
      palette="lagoon"
      onPaletteChange={() => pressed.push('theme')}
      //? `r` has a button below; `B` has none, so it is the one hint that stays text
      footerHints="[r] refresh · [B] checkout branch"
      footerActions={[{ id: 'refresh', label: 'Refresh', hotkey: 'r', onPress: () => pressed.push('refresh') }]}
    >
      <Text>body</Text>
    </AppShell>,
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      patchConsole: false,
      onRender: emitFrame,
    },
  );
  try {
    await Bun.sleep(200);
    const footer = output.split('\n').find((line) => line.includes('Quit')) ?? '';
    for (const key of ['[r]', '[t]', '[q]']) expect(footer.split(key).length - 1).toBe(1);
    expect(footer).toContain('[B] checkout branch');
    expect(footer).toContain('Tab switch tab');

    const lines = output.split('\n');
    const row = lines.findIndex((line) => line.includes('Quit'));
    for (const label of ['Refresh', 'Theme'])
      for (const type of ['press', 'release'] as const)
        emitMouseEvent({
          type,
          button: 'left',
          row: row + 1,
          column: (lines[row] ?? '').indexOf(label) + 2,
          ctrl: false,
          alt: false,
          shift: false,
        });
    await Bun.sleep(50);
    expect(pressed).toEqual(['refresh', 'theme']);
  } finally {
    setMouseReporting(reporting);
    app.unmount();
  }
});
