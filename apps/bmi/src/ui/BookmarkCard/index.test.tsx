import { expect, test } from 'bun:test';
import { renderToString } from 'ink';

import type { PreviewCache } from '../../core/preview';
import { WORKSPACE_BADGE } from '../WorkspaceChip';
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
  expect(output.split('\n')).toHaveLength(12);
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
  expect(output.split('\n')).toHaveLength(7);
  expect(output).toContain(entry.title);
  expect(output).toContain(entry.url);
});

test('the title and URL sit beside the favicon, one under the other', () => {
  const lines = Bun.stripANSI(
    renderToString(
      <BookmarkCard entry={entry} cache={cache} auto={false} width={34} selected={false} />,
      { columns: 34 },
    ),
  ).split('\n');
  const titleRow = lines.findIndex((line) => line.includes(entry.title));
  expect(lines[titleRow + 1]).toContain(entry.url);
  //? Both start in the same column: past the 4-cell favicon and its gap, not under it
  expect(lines[titleRow + 1]?.indexOf(entry.url)).toBe(lines[titleRow]?.indexOf(entry.title));
  expect(lines[titleRow]?.indexOf(entry.title)).toBeGreaterThanOrEqual(6);
});

test('only a workspace page carries the badge', () => {
  const render = (sources: ('user' | 'workspace')[]) =>
    Bun.stripANSI(
      renderToString(
        <BookmarkCard
          entry={{ ...entry, sources }}
          cache={cache}
          auto={false}
          width={34}
          selected={false}
        />,
        { columns: 34 },
      ),
    );
  expect(render(['user'])).not.toContain(WORKSPACE_BADGE);
  expect(render(['workspace'])).toContain(WORKSPACE_BADGE);
  expect(render(['workspace', 'user'])).toContain(WORKSPACE_BADGE);
});

test('the workspace chip is laid over the top border, at its right corner', () => {
  const [top] = Bun.stripANSI(
    renderToString(
      <BookmarkCard
        entry={{ ...entry, sources: ['workspace'] }}
        cache={cache}
        auto={false}
        width={34}
        selected={false}
      />,
      { columns: 34 },
    ),
  ).split('\n');
  expect(top?.startsWith('╭')).toBe(true);
  expect(top?.trimEnd().endsWith(`${WORKSPACE_BADGE} workspace`)).toBe(true);
  expect(top?.length).toBeLessThanOrEqual(34);
});

test('without its image a card keeps only the favicon, title and URL', () => {
  const output = Bun.stripANSI(
    renderToString(
      <BookmarkCard
        entry={entry}
        cache={cache}
        auto={false}
        width={34}
        selected={false}
        showImage={false}
      />,
      { columns: 34 },
    ),
  );
  expect(output).not.toContain('No preview image');
  expect(output).toContain(entry.title);
  expect(output).toContain(entry.url);
  expect(output.split('\n')).toHaveLength(4);
});
