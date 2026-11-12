import { expect, test } from 'bun:test';

import { withHeads } from '.';

test('suggested branches keep their order and take the provider’s commit when it has one', () => {
  const merged = withHeads(
    [
      { name: 'master', sha: '', message: "build_fe-nginx's default" },
      { name: 'gone', sha: '', message: 'one of CODE_BRANCH’s choices' },
    ],
    [
      { name: 'gone-not', sha: 'b', committedAt: '2026-11-02' },
      { name: 'master', sha: 'a', committedAt: '2026-11-01', message: 'Merge release' },
    ],
  );
  expect(merged).toEqual([
    { name: 'master', sha: 'a', committedAt: '2026-11-01', message: "Merge release\nbuild_fe-nginx's default" },
    { name: 'gone', sha: '', message: 'one of CODE_BRANCH’s choices' },
  ]);
});
