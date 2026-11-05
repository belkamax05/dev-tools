import { expect, test } from 'bun:test';

import { quoteArg, shellQuote, singleQuote } from '.';

test('shellQuote leaves plain words alone and quotes the rest', () => {
  expect(shellQuote(['bun', 'add', 'react@^19.3.0'])).toBe('bun add react@^19.3.0');
  expect(shellQuote(['cd', "/tmp/it's here"])).toBe(`cd '/tmp/it'\\''s here'`);
  expect(shellQuote(['echo', ''])).toBe(`echo ''`);
});

test('quoteArg quotes globs, variables and spaces', () => {
  expect(quoteArg('*.ts')).toBe(`'*.ts'`);
  expect(quoteArg('$HOME')).toBe(`'$HOME'`);
  expect(quoteArg('packages:lock')).toBe('packages:lock');
});

test('singleQuote always quotes', () => {
  expect(singleQuote('FLAG=true')).toBe(`'FLAG=true'`);
  expect(singleQuote("it's")).toBe(`'it'\\''s'`);
});

test('what it quotes survives a real shell unchanged', async () => {
  const args = ["it's", 'a b', '$HOME', '*', 'x"y', ''];
  const proc = Bun.spawn(['sh', '-c', `printf '%s\\n' ${shellQuote(args)}`], { stdout: 'pipe' });
  expect(await new Response(proc.stdout).text()).toBe(`${args.join('\n')}\n`);
});
