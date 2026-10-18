import { expect, test } from 'bun:test';
import alignFileDiff from '.';

test('inserted lines get blank left rows so matching context stays aligned', () => {
  const rows = alignFileDiff(
    'a\nb\nc\n',
    'a\nx\ny\nb\nc\n',
    '@@ -1,3 +1,5 @@\n a\n+x\n+y\n b\n c\n',
  );
  expect(rows.map(({ before, after }) => [before, after])).toEqual([
    [1, 1],
    [undefined, 2],
    [undefined, 3],
    [2, 4],
    [3, 5],
  ]);
});

test('replacement blocks pair changes and pad excess deletions without losing context', () => {
  const rows = alignFileDiff('a\nb\nc\nd\n', 'a\nx\nd\n', '@@ -1,4 +1,3 @@\n a\n-b\n-c\n+x\n d\n');
  expect(rows).toEqual([
    { before: 1, after: 1, changed: false },
    { before: 2, after: 2, changed: true },
    { before: 3, after: undefined, changed: true },
    { before: 4, after: 3, changed: false },
  ]);
});

test('zero-length hunk ranges and unchanged gaps keep their original line numbers', () => {
  expect(alignFileDiff('', 'new\n', '@@ -0,0 +1 @@\n+new\n')).toEqual([
    { before: undefined, after: 1, changed: true },
  ]);
  expect(
    alignFileDiff('a\nb\nc\n', 'a\nx\nc\n', '@@ -2 +2 @@\n-b\n+x\n').map(({ before, after }) => [
      before,
      after,
    ]),
  ).toEqual([
    [1, 1],
    [2, 2],
    [3, 3],
  ]);
});
