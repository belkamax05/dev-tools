import { describe, expect, test } from 'bun:test';

import {
  coerceList,
  coerceTags,
  hasBookmark,
  mergeLists,
  normalizeUrl,
  urlKey,
  withBookmark,
  withGroup,
  withoutBookmark,
  withoutGroup,
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
});

describe('coerceList', () => {
  test('keeps what is usable and drops the rest', () => {
    const list = coerceList({
      bookmarks: ['bun.sh', { url: '' }, 42, { url: 'https://x.org', keywords: 'one, two' }],
      groups: [
        {
          name: 'Jira',
          bookmarks: [{ url: 'https://acme.atlassian.net', title: ' Board ' }],
        },
        { bookmarks: ['https://nameless.org'] },
        { name: 'jira', pages: ['https://acme.atlassian.net/2'] },
      ],
    });
    expect(list.bookmarks).toEqual([
      { url: 'https://bun.sh/' },
      { url: 'https://x.org/', tags: ['one', 'two'] },
    ]);
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0]?.name).toBe('Jira');
    expect(list.groups[0]?.bookmarks.map((page) => page.title ?? page.url)).toEqual([
      'Board',
      'https://acme.atlassian.net/2',
    ]);
  });
  test('survives garbage', () => {
    expect(coerceList(null)).toEqual({ bookmarks: [], groups: [] });
    expect(coerceList({ groups: 'x', bookmarks: {} })).toEqual({
      bookmarks: [],
      groups: [],
    });
  });
});

describe('mergeLists', () => {
  const staticList = coerceList({
    bookmarks: ['https://bun.sh'],
    groups: [
      {
        name: 'jira',
        description: 'tracker',
        tags: ['work'],
        bookmarks: [
          {
            url: 'https://jira.example.com/board',
            title: 'Board',
            tags: ['scrum'],
          },
        ],
      },
    ],
  });
  const user = coerceList({
    groups: [
      {
        name: 'JIRA',
        bookmarks: [
          { url: 'jira.example.com/board/', title: 'My board', tags: ['mine'] },
          'https://jira.example.com/backlog',
        ],
      },
      { name: 'reading', bookmarks: ['https://bun.sh'] },
    ],
  });
  const library = mergeLists([
    { source: 'static', list: staticList },
    { source: 'user', list: user },
  ]);

  test('matches groups by name regardless of case, keeping the first spelling', () => {
    expect(library.groups.map((group) => group.name)).toEqual(['jira', 'reading']);
    expect(library.groups[0]?.sources).toEqual(['static', 'user']);
    expect(library.groups[0]?.description).toBe('tracker');
  });

  test('merges one page from both lists, the user’s words winning and tags joined', () => {
    const board = library.groups[0]?.entries[0];
    expect(library.groups[0]?.entries).toHaveLength(2);
    expect(board?.title).toBe('My board');
    expect(board?.tags).toEqual(['scrum', 'mine']);
    expect(board?.sources).toEqual(['static', 'user']);
  });

  test('a page in two groups is two entries', () => {
    expect(library.entries.filter((entry) => urlKey(entry.url) === 'bun.sh')).toHaveLength(2);
    expect(new Set(library.entries.map((entry) => entry.id)).size).toBe(library.entries.length);
  });

  test('lists ungrouped pages first', () => {
    expect(library.entries[0]?.group).toBeUndefined();
  });
});

describe('editing the user list', () => {
  const empty = coerceList({});

  test('adds into a new group, then updates in place', () => {
    const once = withBookmark(empty, { url: 'https://a.org/' }, 'Docs');
    const twice = withBookmark(once, { url: 'https://a.org', title: 'A' }, 'docs');
    expect(twice.groups).toEqual([
      { name: 'Docs', bookmarks: [{ url: 'https://a.org', title: 'A' }] },
    ]);
  });

  test('replace clears fields the update leaves out', () => {
    const titled = withBookmark(empty, {
      url: 'https://a.org/',
      title: 'A',
      tags: ['x'],
    });
    const cleared = withBookmark(titled, { url: 'https://a.org/', tags: ['x'] }, undefined, {
      replace: true,
    });
    expect(cleared.bookmarks).toEqual([{ url: 'https://a.org/', tags: ['x'] }]);
  });

  test('removes only from the named group', () => {
    const list = withBookmark(
      withBookmark(empty, { url: 'https://a.org/' }),
      { url: 'https://a.org/' },
      'g',
    );
    const removed = withoutBookmark(list, 'https://a.org', 'g');
    expect(hasBookmark(removed, 'https://a.org', 'g')).toBe(false);
    expect(hasBookmark(removed, 'https://a.org')).toBe(true);
  });

  test('groups are added, updated and removed by name', () => {
    const list = withGroup(withGroup(empty, { name: 'Jira' }), {
      name: 'jira',
      description: 'd',
    });
    expect(list.groups).toEqual([{ name: 'Jira', description: 'd', bookmarks: [] }]);
    expect(withoutGroup(list, 'JIRA').groups).toEqual([]);
  });
});
