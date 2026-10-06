// biome-ignore-all lint/suspicious/noTemplateCurlyInString: dotenv's ${VAR} syntax is what these strings test

import { describe, expect, test } from 'bun:test';

import { evaluate, parse, parseAssignment, parseDotenv, quoteValue } from './index';

describe('parseDotenv', () => {
  test('reads plain, exported, spaced and colon assignments; skips comments', () => {
    const text = '# top\nA=1\nexport B=two\nC = three \nD: four\n\n  # indented comment\n';
    expect(parse(text)).toEqual({ A: '1', B: 'two', C: 'three', D: 'four' });
  });

  test('a bare value ends at " #", but a # inside a word stays', () => {
    expect(parse('URL=http://x/#anchor # the docs\nN=5 #five')).toEqual({
      URL: 'http://x/#anchor',
      N: '5',
    });
  });

  test('quotes: double has escapes, single and backtick are literal, all may span lines', () => {
    const text = [
      'D="a\\nb \\"q\\" # not a comment"',
      "S='a\\nb $HOME'",
      'B=`x $Y`',
      'PEM="-----BEGIN-----',
      'abc',
      '-----END-----"',
      'AFTER=ok',
    ].join('\n');
    expect(parse(text, { HOME: '/h' })).toEqual({
      D: 'a\nb "q" # not a comment',
      S: 'a\\nb $HOME',
      B: 'x $Y',
      PEM: '-----BEGIN-----\nabc\n-----END-----',
      AFTER: 'ok',
    });
  });

  test('reports bad lines and an unclosed quote without losing the rest', () => {
    const { entries, errors } = parseDotenv('GOOD=1\nnot a line\n1BAD=x\nOPEN="never\nLAST=2');
    expect(entries.map((entry) => entry.key)).toEqual(['GOOD', 'OPEN']);
    expect(errors.map((error) => error.line)).toEqual([2, 3, 4]);
  });

  test('keeps the line each entry starts on', () => {
    const { entries } = parseDotenv('\n# c\nA=1\nB="x\ny"\nC=3');
    expect(entries.map((entry) => [entry.key, entry.line])).toEqual([
      ['A', 3],
      ['B', 4],
      ['C', 6],
    ]);
  });
});

describe('expansion', () => {
  test('$NAME, ${NAME}, defaults and earlier keys of the same file', () => {
    const text = [
      'HOST=localhost',
      'URL=http://$HOST:${PORT:-3000}/x',
      'EMPTY=',
      'A=${EMPTY:-colon}',
      'B=${EMPTY-dash}',
      'C=${NOPE-${HOST}}',
      'D=\\$HOST',
      'E=${UNSET}end',
    ].join('\n');
    expect(parse(text)).toMatchObject({
      URL: 'http://localhost:3000/x',
      A: 'colon',
      B: '',
      C: 'localhost',
      D: '$HOST',
      E: 'end',
    });
  });

  test('expand: false keeps every $', () => {
    const [entry] = parseDotenv('X=$HOME/${A:-b}').entries;
    expect(entry && evaluate(entry, () => 'v', { expand: false })).toBe('$HOME/${A:-b}');
  });
});

describe('writing values back', () => {
  test('quoteValue round-trips through the parser', () => {
    for (const value of [
      'plain',
      'with space',
      'a"b',
      'line\nbreak',
      'cost $5',
      'back\\slash',
      '',
    ]) {
      expect(parse(`K=${quoteValue(value)}`).K).toBe(value);
    }
  });

  test('parseAssignment', () => {
    expect(parseAssignment('A=b=c')).toEqual({ key: 'A', value: 'b=c' });
    expect(parseAssignment('export X=1')).toEqual({ key: 'X', value: '1' });
    expect(parseAssignment('=x')).toBeUndefined();
    expect(parseAssignment('9A=x')).toBeUndefined();
  });
});
