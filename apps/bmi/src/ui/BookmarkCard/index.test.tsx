import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import type { PreviewCache } from '../../core/preview';
import BookmarkCard from './index';

const cache: PreviewCache = {
  directory: '',
  load: async () => {},
  get: () => undefined,
  ensure: async () => {
    throw new Error('manual previews must not fetch');
  },
  icon: async () => undefined,
  clear: async () => {},
};

const entry = {
  id: 'test',
  url: 'https://example.com',
  title: 'Example bookmark',
  tags: [],
  sources: ['user' as const],
};

test('a card reserves its image area and shows its title and URL without a preview', () => {
  const output = Bun.stripANSI(
    renderToString(<BookmarkCard entry={entry} cache={cache} auto={false} width={34} selected />, {
      columns: 34,
    }),
  );
  expect(output).toContain('No preview image');
  expect(output).toContain(entry.title);
  expect(output).toContain(entry.url);
  expect(output.split('\n')).toHaveLength(13);
  expect(output.split('\n').every((line) => line.length <= 34)).toBe(true);
});

test('short terminals shrink the image area while retaining bookmark information', () => {
  const output = Bun.stripANSI(
    renderToString(
      <BookmarkCard
        entry={entry}
        cache={cache}
        auto={false}
        width={34}
        imageRows={3}
        selected={false}
      />,
      { columns: 34 },
    ),
  );
  expect(output.split('\n')).toHaveLength(8);
  expect(output).toContain(entry.title);
  expect(output).toContain(entry.url);
});
