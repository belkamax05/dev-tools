import { expect, test } from 'bun:test';

import terminalText from './index';

test('tabs become spaces up to the next stop, so the line is as wide as Ink measures it', () => {
  expect(terminalText('\tif (x)')).toBe('    if (x)');
  expect(terminalText('+\treturn')).toBe('+   return');
  expect(terminalText('ab\tc')).toBe('ab  c');
  expect(terminalText('abcd\te')).toBe('abcd    e');
  const line = terminalText('+y\tif (x) {\t\treturn\t1;\t\t\t}');
  expect(line).not.toContain('\t');
  expect(Bun.stringWidth(line)).toBe(line.length);
});

test('tab stops are counted in cells, so a wide character before a tab still lines up', () => {
  expect(terminalText('日\tx')).toBe('日  x');
});

test('other control characters are drawn as a replacement mark instead of being sent', () => {
  expect(terminalText('a\rb')).toBe('a�b');
  expect(terminalText('\u001b[31mred')).toBe('�[31mred');
});

test('a line with nothing to replace comes back as it was', () => {
  const line = 'plain text — with “quotes”';
  expect(terminalText(line)).toBe(line);
});
