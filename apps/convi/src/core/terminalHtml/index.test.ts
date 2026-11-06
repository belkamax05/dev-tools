import { expect, test } from 'bun:test';
import { ESC } from '@/dev-tools/ui/terminal/ansi';
import parseAnsi from '@/dev-tools/ui/terminal/ansi/parse';

import { TERMINAL_PALETTE, terminalHtml } from '.';

const preOf = (html: string) => html.match(/<pre>([\s\S]*)<\/pre>/)?.[1];
const parse = (input: string) => parseAnsi(input, { palette: TERMINAL_PALETTE });

test('title, prompt and escaped, coloured lines', () => {
  const html = terminalHtml(parse(`${ESC}[1;31m<b>&${ESC}[0m ok\n`), {
    title: 'dfs-fe — validate',
    prompt: 'bun run validate',
    promptLabel: 'dfs-fe',
  });
  expect(html).toContain('<span class="t">dfs-fe — validate</span>');
  expect(preOf(html)).toBe(
    '<span class="p">dfs-fe ❯</span> bun run validate\n<span style="color:#f38ba8;font-weight:700">&lt;b&gt;&amp;</span> ok',
  );
});

test('blank lines at either end are dropped; no prompt or title when not given', () => {
  const html = terminalHtml(parse('\n\n  \nbody\n\n'));
  expect(preOf(html)).toBe('body');
  expect(html).not.toContain('class="t"');
});

test('an image is an <img>: in its asked-for cells, or at its own size, never wider than the terminal', () => {
  const image = { src: 'data:image/png;base64,AA==', width: 300, height: 100 };
  const line = (extra = {}) => [{ text: '', style: {}, image: { ...image, ...extra } }];
  expect(preOf(terminalHtml([line({ cols: 10, rows: 3 })], { columns: 80 }))).toBe(
    '<img src="data:image/png;base64,AA==" style="width:10ch;height:57px;max-width:80ch;vertical-align:top">',
  );
  expect(preOf(terminalHtml([line()]))).toContain(
    'style="width:300px;height:auto;aspect-ratio:300/100;max-width:120ch;vertical-align:top"',
  );
});

test('inverse swaps colours, falling back to the terminal defaults', () => {
  expect(preOf(terminalHtml(parse(`${ESC}[7mx`)))).toBe(
    '<span style="color:#1e1e2e;background:#cdd6f4">x</span>',
  );
});
