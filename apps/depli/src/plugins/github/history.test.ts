import { expect, test } from 'bun:test';

import { commitRun } from './history';

test('a commit becomes a history run: short SHA, time, author, first line of the message', () => {
  const run = commitRun(
    {
      sha: '1a2b3c4d5e6f',
      html_url: 'https://github.com/o/app/commit/1a2b3c4d5e6f',
      commit: {
        message: 'Fix basket\n\nlong body',
        author: { name: 'Maksym', date: '2026-10-19T12:00:00Z' },
        committer: { date: '2026-10-19T12:05:00Z' },
      },
      author: { login: 'mb' },
    },
    'develop',
  );
  expect(run).toMatchObject({
    id: '1a2b3c4d5e6f',
    label: '1a2b3c4d',
    sha: '1a2b3c4d5e6f',
    branch: 'develop',
    detail: 'Fix basket',
    at: Date.parse('2026-10-19T12:05:00Z'),
    actor: { login: 'mb', name: 'Maksym' },
  });
});
