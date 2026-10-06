import { describe, expect, test } from 'bun:test';

import {
  categoriesOf,
  coerceList,
  coerceTags,
  expandTag,
  findBookmark,
  hasBookmark,
  mergeLists,
  normalizeUrl,
  placementOf,
  urlKey,
  withBookmark,
  withoutBookmark,
  withoutTag,
  withTag,
  workspaceOnly,
} from '.';

describe('normalizeUrl', () => {
  test('adds https to a bare host', () => {
    expect(normalizeUrl('github.com/x')).toBe('https://github.com/x');
  });
  test('keeps a URL with a scheme', () => {
    expect(normalizeUrl('http://localhost:3000/a')).toBe('http://localhost:3000/a');
  });
  test('refuses what is not a page', () => {
    expect(normalizeUrl('')).toBeUndefined();
    expect(normalizeUrl('mailto:me@x.org')).toBeUndefined();
    expect(normalizeUrl('not a url')).toBeUndefined();
  });
});

describe('urlKey', () => {
  test('ignores scheme, www, trailing slash and fragment', () => {
    expect(urlKey('https://www.Example.com/a/#top')).toBe(urlKey('http://example.com/a'));
  });
  test('keeps the query', () => {
    expect(urlKey('https://x.org/?a=1')).not.toBe(urlKey('https://x.org/?a=2'));
  });
});

describe('coerceTags', () => {
  test('accepts arrays, comma strings and several fields at once', () => {
    expect(coerceTags(['A', '#b'], 'b, c ,', undefined)).toEqual(['a', 'b', 'c']);
  });
  test('normalises nested paths', () => {
    expect(coerceTags(' Repositories / GitLab ', 'a//b/')).toEqual(['repositories/gitlab', 'a/b']);
  });
});

describe('expandTag', () => {
  test('a tag implies each of its parents', () => {
    expect(expandTag('a/b/c')).toEqual(['a', 'a/b', 'a/b/c']);
  });
});

describe('coerceList', () => {
  test('keeps what is usable, and one page written twice is one page', () => {
    const list = coerceList({
      tags: { Jira: { description: ' The tracker ', order: 2 }, 'a / b': 'Nested' },
      bookmarks: [
        'bun.sh',
        { url: '' },
        42,
        { url: 'https://x.org', keywords: 'one, two' },
        { url: 'https://www.x.org/', title: 'X', tags: ['three'] },
      ],
    });
    expect(list.tags).toEqual({
      jira: { description: 'The tracker', order: 2 },
      'a/b': { description: 'Nested' },
    });
    expect(list.bookmarks).toEqual([
      { url: 'https://bun.sh/' },
      { url: 'https://x.org/', title: 'X', tags: ['one', 'two', 'three'] },
    ]);
  });

  test('tags may be a list of names or of records', () => {
    expect(coerceList({ tags: ['jira', { name: 'docs', description: 'd' }, 7] }).tags).toEqual({
      jira: {},
      docs: { description: 'd' },
    });
  });

  test('reads the old groups: each a declared tag, on its pages with its own tags', () => {
    const list = coerceList({
      bookmarks: ['https://bun.sh'],
      groups: [
        {
          name: 'Jira',
          description: 'tracker',
          tags: ['work'],
          bookmarks: [{ url: 'https://acme.atlassian.net', title: 'Board', tags: ['scrum'] }],
        },
        { bookmarks: ['https://nameless.org'] },
        { name: 'reading', pages: ['https://bun.sh'] },
      ],
    });
    expect(list.tags).toEqual({ jira: { description: 'tracker' }, reading: {} });
    expect(list.bookmarks).toEqual([
      { url: 'https://bun.sh/', tags: ['reading'] },
      { url: 'https://acme.atlassian.net/', title: 'Board', tags: ['jira', 'work', 'scrum'] },
    ]);
  });

  test('survives garbage', () => {
    expect(coerceList(null)).toEqual({ tags: {}, bookmarks: [] });
    expect(coerceList({ tags: 'x', bookmarks: {}, groups: 3 })).toEqual({
      tags: {},
      bookmarks: [],
    });
  });
});

describe('mergeLists', () => {
  const workspaceList = coerceList({
    tags: { jira: { description: 'tracker' }, repositories: {}, 'repositories/gitlab': {} },
    bookmarks: [
      'https://bun.sh',
      { url: 'https://jira.example.com/board', title: 'Board', tags: ['jira', 'scrum'] },
      { url: 'https://gitlab.example/wc', title: 'wc', tags: ['repositories/gitlab', 'backend'] },
    ],
  });
  const user = coerceList({
    tags: { JIRA: { description: 'mine' }, reading: { order: 0 } },
    bookmarks: [
      { url: 'jira.example.com/board/', title: 'My board', tags: ['mine'] },
      { url: 'https://bun.sh', tags: ['reading', 'jira'] },
    ],
  });
  const library = mergeLists([
    { source: 'workspace', list: workspaceList },
    { source: 'user', list: user },
  ]);
  const entry = (title: string) => library.entries.find((each) => each.title === title);

  test('one entry per page, the user’s words winning and tags joined', () => {
    expect(library.entries).toHaveLength(3);
    expect(entry('My board')?.tags).toEqual(['jira', 'scrum', 'mine']);
    expect(entry('My board')?.sources).toEqual(['workspace', 'user']);
  });

  test('declared tags are a tree, ordered, then the plain ones A–Z', () => {
    expect(library.tags.map((tag) => [tag.key, tag.depth, tag.declared])).toEqual([
      ['reading', 0, true],
      ['jira', 0, true],
      ['repositories', 0, true],
      ['repositories/gitlab', 1, true],
      ['backend', 0, false],
      ['mine', 0, false],
      ['scrum', 0, false],
    ]);
    expect(categoriesOf(library).find((tag) => tag.key === 'jira')).toMatchObject({
      description: 'mine',
      sources: ['workspace', 'user'],
    });
  });

  test('a tag counts the pages under it', () => {
    const counts = Object.fromEntries(library.tags.map((tag) => [tag.key, tag.entries.length]));
    expect(counts.jira).toBe(2);
    expect(counts.repositories).toBe(1);
  });

  test('a page is placed under its most specific categories only', () => {
    const bun = library.entries.find((each) => each.url === 'https://bun.sh/');
    expect(placementOf(entry('wc')!, library)).toEqual(['repositories/gitlab']);
    expect(placementOf(bun!, library).sort()).toEqual(['jira', 'reading']);
    expect(placementOf(entry('My board')!, library)).toEqual(['jira']);
  });

  test('a page under an undeclared nested tag is placed under its declared parent', () => {
    const nested = mergeLists([
      {
        source: 'user',
        list: coerceList({ tags: ['docs'], bookmarks: [{ url: 'a.org', tags: ['docs/api'] }] }),
      },
    ]);
    expect(placementOf(nested.entries[0]!, nested)).toEqual(['docs']);
  });
});

describe('editing the user list', () => {
  const empty = coerceList({});

  test('adds a page, then updates it in place', () => {
    const once = withBookmark(empty, { url: 'https://a.org/' });
    const twice = withBookmark(once, { url: 'https://a.org', title: 'A' });
    expect(twice.bookmarks).toEqual([{ url: 'https://a.org', title: 'A' }]);
  });

  test('replace clears fields the update leaves out', () => {
    const titled = withBookmark(empty, { url: 'https://a.org/', title: 'A', tags: ['x'] });
    const cleared = withBookmark(titled, { url: 'https://a.org/', tags: ['x'] }, { replace: true });
    expect(cleared.bookmarks).toEqual([{ url: 'https://a.org/', tags: ['x'] }]);
  });

  test('finds and removes a page by any spelling of its URL', () => {
    const list = withBookmark(empty, { url: 'https://a.org/' });
    expect(findBookmark(list, 'http://www.a.org')?.url).toBe('https://a.org/');
    expect(hasBookmark(withoutBookmark(list, 'a.org'), 'https://a.org')).toBe(false);
  });

  test('declares a tag, updating what it says', () => {
    const list = withTag(withTag(empty, 'Jira'), 'jira', { description: 'd' });
    expect(list.tags).toEqual({ jira: { description: 'd' } });
  });

  test('taking a category away keeps its pages, without the tag', () => {
    const list = withoutTag(
      {
        tags: { jira: {}, docs: {} },
        bookmarks: [
          { url: 'https://a.org/', tags: ['jira'] },
          { url: 'https://b.org/', tags: ['jira', 'docs'] },
        ],
      },
      'jira',
    );
    expect(list).toEqual({
      tags: { docs: {} },
      bookmarks: [{ url: 'https://a.org/' }, { url: 'https://b.org/', tags: ['docs'] }],
    });
  });
});

describe('workspaceOnly', () => {
  const library = mergeLists([
    {
      source: 'workspace',
      list: coerceList({ tags: ['jira'], bookmarks: ['team.example', 'jira.example'] }),
    },
    {
      source: 'user',
      list: coerceList({
        tags: ['private'],
        bookmarks: [
          'mine.example',
          { url: 'team.example', title: 'Renamed' },
          { url: 'secret.example', tags: ['private'] },
        ],
      }),
    },
  ]);
  const shown = workspaceOnly(library);

  test("drops the user's own pages and categories", () => {
    expect(categoriesOf(shown).map((tag) => tag.key)).toEqual(['jira']);
    expect(shown.entries.map((each) => each.url)).toEqual([
      'https://team.example/',
      'https://jira.example/',
    ]);
  });

  test('keeps a workspace page the user retitled, with their title', () => {
    expect(shown.entries[0]?.title).toBe('Renamed');
  });
});
