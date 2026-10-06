import { describe, expect, test } from 'bun:test';

import { coerceList, mergeLists } from '../bookmarks';
import { coerceRepoToggles, githubRepoOf, repoLinksOf } from '.';

describe('githubRepoOf', () => {
  test('finds the repository from any page of it', () => {
    expect(githubRepoOf('https://github.com/acme/web')).toEqual({
      owner: 'acme',
      name: 'web',
      url: 'https://github.com/acme/web',
    });
    expect(githubRepoOf('https://www.github.com/acme/web.git')?.url).toBe(
      'https://github.com/acme/web',
    );
    expect(githubRepoOf('https://github.com/acme/web/pull/12')?.name).toBe('web');
  });

  test("is not fooled by GitHub's own pages or other hosts", () => {
    expect(githubRepoOf('https://github.com/pulls')).toBeUndefined();
    expect(githubRepoOf('https://github.com/pulls/review-requested')).toBeUndefined();
    expect(githubRepoOf('https://github.com/orgs/acme/people')).toBeUndefined();
    expect(githubRepoOf('https://github.com/acme')).toBeUndefined();
    expect(githubRepoOf('https://gitlab.com/acme/web')).toBeUndefined();
  });
});

describe('repoLinksOf', () => {
  const ids = (url: string, toggles?: Parameters<typeof repoLinksOf>[1]) =>
    repoLinksOf(url, toggles)?.links.map((link) => link.id);

  test('pull requests, Actions and Pages by default', () => {
    expect(repoLinksOf('https://github.com/acme/web')?.links).toEqual([
      { id: 'pulls', label: 'Pull requests', hotkey: 'P', url: 'https://github.com/acme/web/pulls' },
      { id: 'actions', label: 'Actions', hotkey: 'A', url: 'https://github.com/acme/web/actions' },
      { id: 'pages', label: 'GitHub Pages', hotkey: 'G', url: 'https://acme.github.io/web/' },
    ]);
  });

  test('toggles switch defaults off and the others on', () => {
    expect(ids('https://github.com/acme/web', { pages: false, issues: true })).toEqual([
      'pulls',
      'actions',
      'issues',
    ]);
  });

  test("an owner's own site repository is the site itself", () => {
    const pages = repoLinksOf('https://github.com/Acme/acme.github.io')?.links.find(
      (link) => link.id === 'pages',
    );
    expect(pages?.url).toBe('https://acme.github.io/');
  });

  test('nothing for a page that is not a repository', () => {
    expect(repoLinksOf('https://bun.sh/docs')).toBeUndefined();
  });
});

describe('the github field', () => {
  test('keeps only known toggles that are booleans', () => {
    expect(coerceRepoToggles({ pages: false, issues: 'yes', nope: true, settings: true })).toEqual({
      pages: false,
      settings: true,
    });
    expect(coerceRepoToggles(['pulls'])).toBeUndefined();
  });

  test("the user's toggles win over the workspace's, key by key", () => {
    const url = 'https://github.com/acme/web';
    const library = mergeLists([
      {
        source: 'workspace',
        list: coerceList({ bookmarks: [{ url, github: { pages: false, issues: true } }] }),
      },
      { source: 'user', list: coerceList({ bookmarks: [{ url, github: { pages: true } }] }) },
    ]);
    expect(library.entries[0]?.github).toEqual({ pages: true, issues: true });
  });
});
