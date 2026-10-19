import { expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { render } from 'ink';

import { emitFrame } from '@/dev-tools/ui/terminal/frames';
import { emitMouseEvent, isMouseReporting, setMouseReporting } from '@/dev-tools/ui/terminal/mouse';

import ValueBlock from '.';

const mount = (node: React.ReactElement) => {
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 12, isTTY: true });
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => {},
    ref: () => {},
    unref: () => {},
  });
  const frame = { output: '' };
  stdout.on('data', (chunk) => {
    frame.output = Bun.stripANSI(chunk.toString());
  });
  const app = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    debug: true,
    patchConsole: false,
    onRender: emitFrame,
  });
  const click = (text: string) => {
    const lines = frame.output.split('\n');
    const row = lines.findIndex((line) => line.includes(text));
    if (row < 0) throw new Error(`No click target: ${text}`);
    for (const type of ['press', 'release'] as const)
      emitMouseEvent({
        type,
        button: 'left',
        row: row + 1,
        column: (lines[row] ?? '').indexOf(text) + 2,
        ctrl: false,
        alt: false,
        shift: false,
      });
  };
  return { frame, click, app };
};

for (const [what, value] of [
  ['a masked secret', 'abc123'],
  ['a 1Password reference', 'op://vault/item/password'],
] as const)
  test(`the reveal and copy offers under ${what} are buttons that do what their keys do`, async () => {
    const reporting = isMouseReporting();
    setMouseReporting(true);
    const pressed: string[] = [];
    const { frame, click, app } = mount(
      <ValueBlock
        name="API_TOKEN"
        value={value}
        secret
        reveal={false}
        secretPreview={
          value.startsWith('op://') ? { state: { status: 'idle' }, onRead: () => {} } : undefined
        }
        onReveal={() => pressed.push('reveal')}
        onCopySecret={() => pressed.push('copy')}
      />,
    );
    try {
      await Bun.sleep(100);
      expect(frame.output).toContain('[v] Reveal secrets');
      expect(frame.output).toContain('[C] Copy secret');
      click('Reveal secrets');
      click('Copy secret');
      await Bun.sleep(50);
      expect(pressed).toEqual(['reveal', 'copy']);
    } finally {
      setMouseReporting(reporting);
      app.unmount();
    }
  });
