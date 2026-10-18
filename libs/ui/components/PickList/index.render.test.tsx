import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import PickList, { type PickItem } from './index';

const WIDTH = 40;

const draw = (items: PickItem[]) =>
  Bun.stripANSI(
    renderToString(
      <PickList
        items={items}
        selected={0}
        visibleRows={items.length}
        width={WIDTH}
        isFocused
        onSelect={() => {}}
        onActivate={() => {}}
      />,
      { columns: 80 },
    ),
  ).split('\n');

test('a label of wide characters is measured in cells, so its row keeps to its width', () => {
  const lines = draw(
    ['日本語のファイル名日本語のファイル名日本語.txt', 'new-📦-file.txt', 'plain.txt'].map(
      (label) => ({
        id: label,
        label,
        hint: 'new',
        controls: [{ id: 'stage', glyph: '[ ]', onPress: () => {} }],
      }),
    ),
  );
  //? Border, three rows, border: a row that wrapped would add a line
  expect(lines).toHaveLength(5);
  for (const line of lines) expect(Bun.stringWidth(line)).toBe(WIDTH);
  //? The checkbox keeps the gap after it rather than being squeezed against the label
  for (const line of lines.slice(1, -1)) expect(line).toMatch(/\[ \] \S/);
  expect(lines[2]).toContain('new-📦-file.txt');
  expect(lines[2]?.trimEnd()).toMatch(/new\s*│$/);
});
