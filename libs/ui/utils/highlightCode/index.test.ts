import { expect, test } from 'bun:test';
import highlightCode, { wrapCodeLine } from '.';

test('TypeScript tokens keep syntax colors and multiline comment state', () => {
  const lines = highlightCode('const name = "hello";\n/* comment\ncontinued */\n', 'file.ts');
  expect(lines[0]!.some((token) => token.role.includes('keyword') && token.text === 'const')).toBe(
    true,
  );
  expect(
    lines[0]!.some((token) => token.role.includes('string') && token.text.includes('hello')),
  ).toBe(true);
  expect(lines[2]!.every((token) => token.role.includes('comment'))).toBe(true);
});

test('unknown files stay readable and wrapping preserves graphemes and token roles', () => {
  const tokens = highlightCode('hello 世界\n', 'file.unknown')[0]!;
  const rows = wrapCodeLine(tokens, 6);
  expect(
    rows
      .flat()
      .map((token) => token.text)
      .join(''),
  ).toBe('hello 世界');
  expect(rows.every((row) => Bun.stringWidth(row.map((token) => token.text).join('')) <= 6)).toBe(
    true,
  );
});
