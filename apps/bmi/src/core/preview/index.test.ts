import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import encodePng from '@/dev-tools/terminal-canvas/encodePng';

import { createPreviewCache, decodeEntities, iconCandidates, isFresh, parseHead } from '.';

describe('parseHead', () => {
  test('prefers Open Graph, resolves URLs, decodes entities', () => {
    const head = parseHead(
      `<html><head>
        <title>Plain &amp; simple</title>
        <meta name="description" content="plain description">
        <meta property="og:title" content='Board &#8212; Sprint 4'>
        <meta content="OG description" property="og:description" />
        <meta property="og:site_name" content="Jira">
        <meta property="og:image" content="/img/card.jpg">
        <link rel="shortcut icon" href="/favicon.ico">
        <link rel="icon" type="image/png" sizes="32x32" href="icons/32.png">
        <link rel="mask-icon" href="/mask.svg">
      </head><body><meta property="og:title" content="ignored"></body></html>`,
      'https://jira.example.com/browse/X-1',
    );
    expect(head.title).toBe('Board — Sprint 4');
    expect(head.description).toBe('OG description');
    expect(head.siteName).toBe('Jira');
    expect(head.image).toBe('https://jira.example.com/img/card.jpg');
    expect(head.icons.map((icon) => icon.href)).toEqual([
      'https://jira.example.com/favicon.ico',
      'https://jira.example.com/browse/icons/32.png',
    ]);
  });

  test('falls back to the plain title and description', () => {
    const head = parseHead(
      '<title>\n  Just a   title </title><meta name="description" content="d">',
      'https://x.org',
    );
    expect(head.title).toBe('Just a title');
    expect(head.description).toBe('d');
  });
});

test('decodeEntities', () => {
  expect(decodeEntities('a &lt;b&gt; &#x41; &unknown;')).toBe('a <b> A &unknown;');
});

describe('iconCandidates', () => {
  test('a mid-size PNG first, SVG never, /favicon.ico last', () => {
    expect(
      iconCandidates(
        [
          { href: 'https://x.org/a.svg', rel: 'icon', type: 'image/svg+xml' },
          { href: 'https://x.org/fav.ico', rel: 'icon' },
          { href: 'https://x.org/apple.png', rel: 'apple-touch-icon' },
          {
            href: 'https://x.org/32.png',
            rel: 'icon',
            type: 'image/png',
            sizes: '32x32',
          },
        ],
        'https://x.org/page',
      ),
    ).toEqual([
      'https://x.org/32.png',
      'https://x.org/apple.png',
      'https://x.org/fav.ico',
      'https://x.org/favicon.ico',
    ]);
  });
});

test('isFresh', () => {
  const now = Date.now();
  expect(isFresh(undefined)).toBe(false);
  expect(isFresh({ url: 'u', fetchedAt: now - 1000, title: 't' }, now)).toBe(true);
  expect(isFresh({ url: 'u', fetchedAt: now - 30 * 864e5, title: 't' }, now)).toBe(false);
  expect(isFresh({ url: 'u', fetchedAt: now - 2 * 864e5, error: 'x' }, now)).toBe(false);
});

describe('createPreviewCache, against a local server', () => {
  let server: ReturnType<typeof Bun.serve>;
  let directory: string;
  let pageHits = 0;
  const icon = encodePng(new Uint8Array(16 * 16 * 4).fill(200), 16, 16);

  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'bmi-preview-'));
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname === '/page') {
          pageHits += 1;
          return new Response(
            '<head><meta property="og:title" content="Hello"><meta property="og:description" content="World"></head>',
            { headers: { 'content-type': 'text/html' } },
          );
        }
        if (pathname === '/moved') return Response.redirect('/page', 302);
        //? Served as .ico but really a PNG, as plenty of sites do
        if (pathname === '/favicon.ico') return new Response(icon);
        return new Response('nope', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        });
      },
    });
  });

  afterAll(() => {
    server.stop(true);
    rmSync(directory, { recursive: true, force: true });
  });

  test('fetches, caches, and reuses a preview with its favicon', async () => {
    const cache = createPreviewCache(directory);
    const url = `http://localhost:${server.port}/page`;
    const preview = await cache.ensure(url);
    expect(preview.title).toBe('Hello');
    expect(preview.description).toBe('World');
    expect(preview.iconFile).toMatch(/\.png$/);
    expect((await cache.icon(preview))?.width).toBe(16);

    await cache.ensure(url);
    expect(pageHits).toBe(1);

    //? A second cache over the same directory reads what the first wrote
    const reopened = createPreviewCache(directory);
    await reopened.load();
    expect(reopened.get(url)?.title).toBe('Hello');
    await reopened.ensure(url, { force: true });
    expect(pageHits).toBe(2);
  });

  test('follows redirects and reports failures without throwing', async () => {
    const cache = createPreviewCache(directory);
    const moved = await cache.ensure(`http://localhost:${server.port}/moved`);
    expect(moved.finalUrl).toBe(`http://localhost:${server.port}/page`);
    const missing = await cache.ensure(`http://localhost:${server.port}/missing`);
    expect(missing.error).toBe('HTTP 404');
    //? Still has the host's favicon
    expect(missing.iconFile).toBeDefined();
  });

  test('clear empties the directory', async () => {
    const cache = createPreviewCache(directory);
    await cache.load();
    await cache.clear();
    expect(await Bun.file(join(directory, 'previews.json')).exists()).toBe(false);
  });
});
