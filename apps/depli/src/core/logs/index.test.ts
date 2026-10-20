import { describe, expect, test } from 'bun:test';

import { appendLog, classifyLine } from '.';

describe('classifyLine', () => {
  test.each([
    ['Finished: SUCCESS', 'ok'],
    ['Finished: FAILURE', 'error'],
    ['ERROR: script returned exit code 1', 'error'],
    ['##[error]Process completed with exit code 2.', 'error'],
    ['Found 0 errors.', 'text'],
    ['npm warn deprecated inflight@1.0.6', 'warn'],
    ['[Pipeline] { (Build)', 'heading'],
    ['[Pipeline] stage', 'heading'],
    ['[Pipeline] // node', 'muted'],
    ['+ docker build -t fe-nginx .', 'command'],
    [' > git fetch --no-tags # timeout=10', 'command'],
    ['Checking out Revision c2d61cd4', 'text'],
  ])('%s → %s', (line, tone) => {
    expect(classifyLine(line).tone).toBe(tone as never);
  });

  test('a leading timestamp is split off, an escape code dropped', () => {
    expect(classifyLine('2026-10-16T09:21:45.1234567Z \x1b[32m##[group]Run npm ci\x1b[0m')).toEqual(
      {
        time: '2026-10-16T09:21:45.1234567Z',
        text: 'Run npm ci',
        tone: 'heading',
      },
    );
  });
});

describe('appendLog', () => {
  test('a line split across chunks is joined', () => {
    const first = appendLog([], '', 'one\ntw');
    expect(first).toEqual({ lines: ['one'], partial: 'tw' });
    expect(appendLog(first.lines, first.partial, 'o\nthree\n')).toEqual({
      lines: ['one', 'two', 'three'],
      partial: '',
    });
  });
});
