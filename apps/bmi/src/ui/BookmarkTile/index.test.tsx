import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import type { PreviewCache } from '../../core/preview';
import { CARD_HEIGHT, CARD_IMAGE_COLS } from '../BookmarkCard';
import { WORKSPACE_BADGE } from '../WorkspaceChip';
import BookmarkTile, { TILE_HEIGHT, TILE_MIN_COLS } from './index';

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
  url: 'https://www.example.com/some/page',
  title: 'Example',
  tags: [],
  sources: ['user' as const],
};

const render = (props: Partial<Parameters<typeof BookmarkTile>[0]> = {}) =>
  Bun.stripANSI(
    renderToString(
      <BookmarkTile
        entry={entry}
        cache={cache}
        auto={false}
        width={TILE_MIN_COLS}
        selected={false}
        {...props}
      />,
      { columns: 40 },
    ),
  ).split('\n');

test('a tile is about half a card tall and a third of one wide', () => {
  expect(TILE_HEIGHT).toBe(Math.floor(CARD_HEIGHT / 2));
  expect(TILE_MIN_COLS * 3).toBeGreaterThanOrEqual(CARD_IMAGE_COLS + 2);
});

test('shows the title and the host, never the preview image, in its height', () => {
  const lines = render({ width: 20 });
  expect(lines).toHaveLength(TILE_HEIGHT);
  expect(lines.join('\n')).toContain(entry.title);
  expect(lines.join('\n')).toContain('example.com');
  expect(lines.join('\n')).not.toContain('preview');
  expect(lines.every((line) => line.length <= 20)).toBe(true);
});

test('a workspace tile carries the short chip over its corner', () => {
  const [top] = render({ entry: { ...entry, sources: ['workspace'] } });
  expect(top?.startsWith('╭')).toBe(true);
  expect(top?.trimEnd().endsWith(WORKSPACE_BADGE)).toBe(true);
});
