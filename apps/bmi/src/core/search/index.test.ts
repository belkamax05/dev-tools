import { describe, expect, test } from 'bun:test';

import { coerceList, mergeLists } from '../bookmarks';
import search, { scoreText } from '.';

const library = mergeLists([
  {
    source: 'workspace',
    list: coerceList({
      bookmarks: [{ url: 'https://bun.sh/docs', title: 'Bun docs', tags: ['runtime'] }],
      groups: [
        {
          name: 'jira',
          description: 'The tracker',
          tags: ['work'],
          bookmarks: [
            {
              url: 'https://acme.atlassian.net/jira/boards/1',
              title: 'Sprint board',
            },
            {
              url: 'https://acme.atlassian.net/jira/backlog',
              title: 'Backlog',
              description: 'Everything not yet planned',
            },
          ],
        },
        {
          name: 'github',
          bookmarks: [
            {
              url: 'https://github.com/pulls',
              title: 'Pull requests',
              tags: ['pr'],
            },
          ],
        },
      ],
    }),
  },
]);

const titles = (query: string) =>
  search(library.entries, library.groups, query).map((hit) => hit.entry.title);

describe('scoreText', () => {
  test('ranks a word start over a substring over a scattered match', () => {
    const start = scoreText('board', 'sprint board') ?? 0;
    const inside = scoreText('oard', 'sprint board') ?? 0;
    const scattered = scoreText('sbd', 'sprint board') ?? 0;
    expect(start).toBeGreaterThan(inside);
    expect(inside).toBeGreaterThan(scattered);
    expect(scattered).toBeGreaterThan(0);
  });

  test('a scattered match starts a word, and only where fuzzy is allowed', () => {
    expect(scoreText('prnt', 'sprint board')).toBeUndefined();
    expect(scoreText('sbd', 'sprint board', false)).toBeUndefined();
    expect(scoreText('board', 'sprint board', false)).toBeDefined();
  });

  test('refuses letters too far apart to mean anything', () => {
    expect(scoreText('ab', `a${'x'.repeat(40)}b`)).toBeUndefined();
    expect(scoreText('zz', 'board')).toBeUndefined();
  });
});

describe('search', () => {
  test('an empty query is every page, in list order', () => {
    expect(titles('')).toEqual(['Bun docs', 'Sprint board', 'Backlog', 'Pull requests']);
  });

  test('a group name finds all of its pages', () => {
    expect(titles('jira').slice(0, 2).sort()).toEqual(['Backlog', 'Sprint board']);
  });

  test('every word has to match somewhere', () => {
    expect(titles('jira board')).toEqual(['Sprint board']);
    expect(titles('jira pulls')).toEqual([]);
  });

  test('finds by description, by host and fuzzily', () => {
    expect(titles('planned')).toEqual(['Backlog']);
    expect(titles('github.com')).toEqual(['Pull requests']);
    expect(titles('sprnt')[0]).toBe('Sprint board');
  });

  test('descriptions only match whole substrings', () => {
    //? r…e…v is in "the tracker … everything"; a scattered match there would be noise
    expect(titles('rev')).toEqual([]);
  });

  test('#tag filters, counting the group’s tags', () => {
    expect(titles('#work').sort()).toEqual(['Backlog', 'Sprint board']);
    expect(titles('#pr')).toEqual(['Pull requests']);
    expect(titles('#work backlog')).toEqual(['Backlog']);
  });

  test('a title match outranks a description match', () => {
    const hits = search(
      mergeLists([
        {
          source: 'user',
          list: coerceList({
            bookmarks: [
              {
                url: 'https://a.org',
                title: 'Other',
                description: 'about deploys',
              },
              { url: 'https://b.org', title: 'Deploys' },
            ],
          }),
        },
      ]).entries,
      [],
      'deploys',
    );
    expect(hits.map((hit) => hit.entry.title)).toEqual(['Deploys', 'Other']);
  });
});
